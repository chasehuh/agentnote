import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/** Login UI only — keep SSO callback public and un-bounced. */
const isLoginPage = createRouteMatcher(["/login", "/login/"]);
const isPublicRoute = createRouteMatcher(["/login(.*)", "/api/version"]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);

/**
 * Protected-first (Clerk BP for internal tools):
 * - signed-out → /login immediately (edge redirect, no blank app shell)
 * - signed-in on /login → / immediately (no login limbo)
 * - /login/sso-callback stays public for the OAuth handshake
 */
export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();

  if (userId && isLoginPage(request)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isPublicRoute(request)) {
    return;
  }

  if (userId) {
    return;
  }

  if (isApiRoute(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
