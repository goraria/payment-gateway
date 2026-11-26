import type { Context } from "hono";
import type { User } from "@/database/schema";
import type { GorthApplication } from "@/lib/constants";

export interface AuthContext {
  /** Delegated credential stays in server memory and is never serialized. */
  accessToken?: string;
  application: GorthApplication;
  clientId: string;
  scopes: string[];
  sessionId: string | null;
  user: User;
}

export interface AppContext {
  auth: AuthContext;
}

export interface ApiEnv {
  Variables: Partial<AppContext>
}

export type ApiContext = Context<ApiEnv>;
