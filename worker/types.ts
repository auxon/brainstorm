export type WalletUser = {
  id: string;
  identityKey: string | null;
  address: string | null;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  picture: string | null;
  /** Cookie identity minted without Yours Wallet. */
  isGuest: boolean;
  /** Google account linked (Drive + sign-in). */
  googleConnected: boolean;
};

export type SessionRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: "unlisted" | "public" | "token";
  view_token: string;
  edit_token: string;
  owner_user_id: string;
  created_at: number;
  updated_at: number;
};

export type IdeaRow = {
  id: string;
  session_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  author_user_id: string;
  author_name: string;
  author_address: string | null;
  position_x: number | null;
  position_y: number | null;
  color: string | null;
  sort_index: number;
  vote_count: number;
  satoshis: number;
  usd_cents?: number;
  created_at: number;
  updated_at: number;
};

export type CommentRow = {
  id: string;
  session_id: string;
  idea_id: string;
  parent_id: string | null;
  body: string;
  author_user_id: string;
  author_name: string;
  author_address: string | null;
  vote_count: number;
  satoshis: number;
  usd_cents?: number;
  created_at: number;
};

export type EdgeRow = {
  id: string;
  session_id: string;
  source_id: string;
  target_id: string;
  label: string | null;
};

export type PublicSession = Omit<SessionRow, "view_token" | "edit_token"> & {
  canEdit: boolean;
  isOwner: boolean;
  featuredUntil?: number | null;
};

export type SessionNft = {
  id: string;
  origin: string;
  txid: string;
  contentHash: string;
  contentType: string;
  mintedBy: string;
  createdAt: number;
};

export type SessionGraph = {
  session: PublicSession;
  ideas: IdeaRow[];
  comments: CommentRow[];
  edges: EdgeRow[];
  myVotes: { targetType: "idea" | "comment"; targetId: string; satoshis: number }[];
  nfts: SessionNft[];
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
