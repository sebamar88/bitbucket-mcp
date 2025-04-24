/**
 * Represents a Bitbucket repository
 */
export interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  description: string;
  is_private: boolean;
  created_on: string;
  updated_on: string;
  size: number;
  language: string;
  has_issues: boolean;
  has_wiki: boolean;
  fork_policy: string;
  owner: BitbucketAccount;
  workspace: BitbucketWorkspace;
  project: BitbucketProject;
  mainbranch?: BitbucketBranch;
  website?: string;
  scm: string;
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket account (user or team)
 */
export interface BitbucketAccount {
  uuid: string;
  display_name: string;
  account_id: string;
  nickname?: string;
  type: "user" | "team";
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket workspace
 */
export interface BitbucketWorkspace {
  uuid: string;
  name: string;
  slug: string;
  type: "workspace";
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket project
 */
export interface BitbucketProject {
  uuid: string;
  key: string;
  name: string;
  description?: string;
  is_private: boolean;
  type: "project";
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket branch reference
 */
export interface BitbucketBranch {
  name: string;
  type: "branch";
}

/**
 * Represents a hyperlink in Bitbucket API responses
 */
export interface BitbucketLink {
  href: string;
  name?: string;
}

/**
 * Represents a Bitbucket pull request
 */
export interface BitbucketPullRequest {
  id: number;
  title: string;
  description: string;
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  author: BitbucketAccount;
  source: BitbucketBranchReference;
  destination: BitbucketBranchReference;
  created_on: string;
  updated_on: string;
  closed_on?: string;
  comment_count: number;
  task_count: number;
  close_source_branch: boolean;
  reviewers: BitbucketAccount[];
  participants: BitbucketParticipant[];
  links: Record<string, BitbucketLink[]>;
  summary?: {
    raw: string;
    markup: string;
    html: string;
  };
}

/**
 * Represents a branch reference in a pull request
 */
export interface BitbucketBranchReference {
  branch: {
    name: string;
  };
  commit: {
    hash: string;
  };
  repository: BitbucketRepository;
}

/**
 * Represents a participant in a pull request
 */
export interface BitbucketParticipant {
  user: BitbucketAccount;
  role: "PARTICIPANT" | "REVIEWER";
  approved: boolean;
  state?: "approved" | "changes_requested" | null;
  participated_on: string;
}
