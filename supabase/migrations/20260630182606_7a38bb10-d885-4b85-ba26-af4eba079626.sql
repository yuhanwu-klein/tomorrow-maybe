
-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- LETTERS
CREATE TABLE public.letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  letter_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  goal text,
  thought text,
  advice text,
  color text NOT NULL DEFAULT '#bde0fe',
  unlock_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  deliver_at timestamptz NOT NULL DEFAULT (
    now() + (random() * (interval '3650 days' - interval '1 day') + interval '1 day')
  ),
  delivered_at timestamptz,
  recipient_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, letter_date)
);
CREATE INDEX letters_user_idx ON public.letters(user_id, letter_date DESC);
CREATE INDEX letters_unlock_idx ON public.letters(unlock_at);
CREATE INDEX letters_delivery_idx ON public.letters(deliver_at) WHERE delivered_at IS NULL;

GRANT SELECT ON public.letters TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.letters TO authenticated;
GRANT ALL ON public.letters TO service_role;
ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;

-- Anyone can read letters once unlocked; owners always read their own (even sealed)
CREATE POLICY "letters_select_unlocked_or_own" ON public.letters FOR SELECT
USING (unlock_at <= now() OR auth.uid() = user_id);

CREATE POLICY "letters_insert_own" ON public.letters FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "letters_update_own" ON public.letters FOR UPDATE
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "letters_delete_own" ON public.letters FOR DELETE
USING (auth.uid() = user_id);

-- REACTIONS
CREATE TABLE public.reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL REFERENCES public.letters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (letter_id, user_id, emoji)
);
CREATE INDEX reactions_letter_idx ON public.reactions(letter_id);
GRANT SELECT ON public.reactions TO anon;
GRANT SELECT, INSERT, DELETE ON public.reactions TO authenticated;
GRANT ALL ON public.reactions TO service_role;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactions_select_all" ON public.reactions FOR SELECT USING (true);
CREATE POLICY "reactions_insert_own" ON public.reactions FOR INSERT
WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reactions_delete_own" ON public.reactions FOR DELETE
USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_username text;
  final_username text;
  suffix int := 0;
BEGIN
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1),
    'user'
  );
  -- sanitize
  base_username := regexp_replace(lower(base_username), '[^a-z0-9_]', '', 'g');
  IF base_username = '' THEN base_username := 'user'; END IF;
  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    final_username,
    COALESCE(NEW.raw_user_meta_data->>'display_name', final_username)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
