-- Adding and removing people in a chat.
-- When someone is added, removed or leaves, the chat shows a short line about it
-- ("Aaron added Steve Williams"). Those lines are posts with kind = 'event'. Their body is
-- a small JSON note ({"type":"added","names":["Steve Williams"]}) that the app turns into
-- words in each person's language. They can't be edited, removed, replied to or pinned,
-- and they don't count as unread messages or pop up as alerts.
ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post','event'));
