-- Typed-address mode for the time clock (Aaron's hard rule, 2026-11-24).
-- While address_mode = 1 the portal never asks the phone for its location. Every punch
-- uses typed_address until the person turns the mode off with the button.
ALTER TABLE users ADD COLUMN address_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN typed_address TEXT;
