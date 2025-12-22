// C:\Users\User\Downloads\taedal-v7\app\src\features\messages\types.ts

export type DMKind = "text" | "post_share" | "artwork_share" | "image" | "voice";

export type DMThreadRow = {
  thread_id: string; // uuid OR synthetic friend:<uuid>
  other_user_id: string;
  other_username: string | null;
  other_avatar_url: string | null;

  accepted_by_me: boolean;
  accepted_by_other: boolean;

  is_request: boolean;
  is_friend: boolean;

  last_message_at: string | null;
  last_message_preview: string | null;

  streak_count: number;
  streak_visible: boolean;
};

export type DMMessageRow = {
  id: number;
  thread_id: string;
  sender_id: string;

  kind: DMKind;

  body: string | null;
  shared_post_id: string | null;

  // NEW (DB column)
  shared_artwork_id: string | null;

  created_at: string;

  // NEW
  meta: Record<string, any>;
};

export type DMFriendRow = {
  other_user_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_url: string | null;
  thread_id: string | null;
};
