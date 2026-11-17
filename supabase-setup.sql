-- ============================================================================
--  우리 사진 보드 — Supabase 설정 SQL
--  기존 가족 앱(family-calendar / family-bookshelf)과 같은 프로젝트를 씁니다.
--    프로젝트: https://tuejokazctxejnpjmwwt.supabase.co  (서울 리전)
--
--  사용법
--   1) Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 RUN.
--      (family-calendar 의 supabase-setup.sql 이 먼저 적용되어 있어야 합니다.
--       관리자 비밀번호 해시가 private.family_secrets 에 들어 있기 때문입니다.)
--   2) 끝입니다. 따로 비밀번호를 넣을 곳은 없습니다.
--      관리자 비밀번호는 이미 가족 비밀번호(1004)와 같은 해시를 그대로 씁니다.
--      평문 비밀번호는 이 파일에도, index.html / app.js 에도 적지 않습니다.
--
--  보안 구조
--   · 사진 목록 읽기 / 사진 올리기만 anon 키로 가능 (RLS + 최소 권한).
--   · 수정·삭제 권한은 anon 에게 주지 않습니다. 삭제는 아래 RPC 로만,
--     RPC 가 먼저 private.family_secrets 의 bcrypt 해시와 비교합니다.
--   · 관리자 비밀번호를 몰라도 사진은 지울 수 없습니다.
-- ============================================================================

-- 0) 선행 조건 확인 ----------------------------------------------------------
do $$
begin
  if to_regclass('private.family_secrets') is null then
    raise exception '먼저 family-calendar 의 supabase-setup.sql 을 실행해 주세요. (관리자 비밀번호 해시를 함께 씁니다)';
  end if;
  if not exists (select 1 from private.family_secrets where family_id = 'family') then
    raise exception 'private.family_secrets 에 family_id = ''family'' 비밀번호가 없습니다.';
  end if;
end $$;

-- 1) 사진 표 -----------------------------------------------------------------
create table if not exists public.photo_board_posts (
  id          uuid primary key default gen_random_uuid(),
  author      text not null check (char_length(btrim(author)) between 1 and 20),
  memo        text not null default '' check (char_length(memo) <= 80),
  image_data  text not null check (
                image_data like 'data:image/%'
                and char_length(image_data) <= 2400000      -- 대략 1.7MB 이하 사진
              ),
  created_at  timestamptz not null default now()
);

comment on table  public.photo_board_posts is '우리 사진 보드 — 참여자가 올린 사진(브라우저에서 줄인 data URL)';
comment on column public.photo_board_posts.image_data is 'data:image/jpeg;base64,... (클라이언트에서 최대 1400px, JPEG 0.82로 축소)';

create index if not exists photo_board_posts_created_idx
  on public.photo_board_posts (created_at desc);

-- 2) RLS 와 권한 -------------------------------------------------------------
alter table public.photo_board_posts enable row level security;

-- 읽기: 누구나(참여자 포함)
drop policy if exists photo_board_read on public.photo_board_posts;
create policy photo_board_read on public.photo_board_posts
  for select to anon, authenticated
  using (true);

-- 올리기: 누구나. 지우기/고치기 정책은 만들지 않습니다.
drop policy if exists photo_board_insert on public.photo_board_posts;
create policy photo_board_insert on public.photo_board_posts
  for insert to anon, authenticated
  with check (
    char_length(btrim(author)) between 1 and 20
    and char_length(coalesce(memo, '')) <= 80
    and image_data like 'data:image/%'
    and char_length(image_data) <= 2400000
  );

-- 테이블 권한은 읽기·추가만 (수정·삭제는 회수)
revoke all on table public.photo_board_posts from anon, authenticated;
grant select, insert on table public.photo_board_posts to anon, authenticated;

-- 3) 관리자 비밀번호 확인 (내부용) -------------------------------------------
--    private.family_secrets(family_id='family').passcode_hash 와 bcrypt 비교.
create or replace function private.photo_board_check(pass text)
returns boolean
language sql
security definer
set search_path = private, extensions, pg_catalog
as $$
  select exists (
    select 1
      from private.family_secrets s
     where s.family_id = 'family'
       and pass is not null
       and s.passcode_hash = extensions.crypt(pass, s.passcode_hash)
  );
$$;

revoke all on function private.photo_board_check(text) from public, anon, authenticated;

-- 4) 앱이 부르는 함수 (public) ----------------------------------------------
-- 4-1) 관리자 모드 열기
create or replace function public.photo_board_unlock(pass text)
returns boolean
language sql
security definer
set search_path = private, public, extensions, pg_catalog
as $$
  select private.photo_board_check(pass);
$$;

-- 4-2) 한 장 삭제
create or replace function public.photo_board_delete_post(pass text, post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = private, public, extensions, pg_catalog
as $$
begin
  if not private.photo_board_check(pass) then
    return false;
  end if;

  delete from public.photo_board_posts where id = post_id;
  return found;
end;
$$;

-- 4-3) 여러 장 한꺼번에 삭제 (‘선택 삭제’)
create or replace function public.photo_board_delete_posts(pass text, post_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = private, public, extensions, pg_catalog
as $$
declare
  v_count integer := 0;
begin
  if not private.photo_board_check(pass) then
    return 0;
  end if;
  if post_ids is null or array_length(post_ids, 1) is null then
    return 0;
  end if;

  with gone as (
    delete from public.photo_board_posts
     where id = any(post_ids)
     returning 1
  )
  select count(*) into v_count from gone;

  return v_count;
end;
$$;

-- 4-4) 함수 실행 권한
revoke all on function public.photo_board_unlock(text) from public;
revoke all on function public.photo_board_delete_post(text, uuid) from public;
revoke all on function public.photo_board_delete_posts(text, uuid[]) from public;

grant execute on function public.photo_board_unlock(text) to anon, authenticated;
grant execute on function public.photo_board_delete_post(text, uuid) to anon, authenticated;
grant execute on function public.photo_board_delete_posts(text, uuid[]) to anon, authenticated;

-- ============================================================================
--  확인용 (필요할 때만 실행)
--    select public.photo_board_unlock('가족비밀번호');        -- true 면 정상
--    select count(*) from public.photo_board_posts;
--  ※ 위 확인용 문장의 비밀번호도 실제 값을 적어 두지 말고 그때그때 입력하세요.
-- ============================================================================
