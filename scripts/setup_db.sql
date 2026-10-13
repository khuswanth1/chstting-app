-- One-time local setup (safe to re-run). Run as the postgres superuser:
--   psql -h localhost -U postgres -f scripts/setup_db.sql
-- Creates the app role + database used by DATABASE_URL in .env.example, and (re)sets the role's password
-- to match, so a pre-existing "chatflow" role with another password is fixed too.
-- Change the password here (and in .env) for anything other than local development.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatflow') THEN
    CREATE ROLE chatflow LOGIN PASSWORD 'chatflow';
  ELSE
    ALTER ROLE chatflow WITH LOGIN PASSWORD 'chatflow';
  END IF;
END
$$;

SELECT 'CREATE DATABASE chatflow OWNER chatflow'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chatflow')\gexec

ALTER DATABASE chatflow OWNER TO chatflow;
