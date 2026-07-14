-- Scheduled email push: every 5 minutes, ask the send-letter-emails edge function
-- to deliver any letters whose unlock time has passed.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop a previous schedule of the same name if it exists, so this migration is re-runnable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-letter-emails') THEN
    PERFORM cron.unschedule('send-letter-emails');
  END IF;
END $$;

SELECT cron.schedule(
  'send-letter-emails',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tgsmvkvdlvgvgjixivif.supabase.co/functions/v1/send-letter-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- public anon key: verify_jwt is off on the function, this only routes the request
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnc212a3ZkbHZndmdqaXhpdmlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzYxNzYsImV4cCI6MjA5ODQxMjE3Nn0.bvBUJNi9fyq0cj8MRnsEUj_KzYNmhsY1eDXf3EsdBLY'
    ),
    body := '{}'::jsonb
  );
  $$
);
