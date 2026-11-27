export type ServiceAccess = "read" | "write";
import type { Context } from "hono";
import type { User } from "@/database/schema";
import type { Application } from "@/utils/constant";

export interface AuthContext {
  /** Delegated credential stays in server memory and is never serialized. */
  accessToken?: string;
  application: Application;
  clientId: string;
  scopes: string[];
  sessionId: string | null;
  user: User;
}

export interface Session {
  auth: AuthContext;
}

export interface Binding {
  Variables: Partial<Session>
}

export type Event = Context<Binding>;
