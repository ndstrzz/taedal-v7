import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  useRouteError,
  isRouteErrorResponse,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";

/* Auth */
import { AuthProvider } from "./routes/_auth/AuthContext";
import RequireAuth from "./routes/_auth/RequireAuth";

/* Frame */
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

/* Pages */
import Home from "./routes/home/Home";
import Explore from "./routes/explore/Explore";
import Discover from "./routes/discover/Discover";
import Contracts from "./routes/contracts/Contracts";
import RequestDetail from "./routes/contracts/RequestDetail";
import PublicProfile from "./routes/profiles/PublicProfile";
import ArtworkDetail from "./routes/art/ArtworkDetail";
import ARPreview from "./routes/art/ARPreview";
import SignIn from "./routes/_auth/SignIn";
import Callback from "./routes/_auth/Callback";
import Account from "./routes/account/Account";
import CreateArtwork from "./routes/create/CreateArtwork";
import StudioHome from "./routes/studio/StudioHome";
import CreateChooser from "./routes/studio/CreateChooser";
import DeployCollection from "./routes/studio/DeployCollection";
import Deploying from "./routes/studio/Deploying";
import CheckoutSuccess from "./routes/checkout/Success";
import DiscoverPage from "./routes/discover/Discover";
import CollectionEdit from "./routes/collection/CollectionEdit";
import CollectionPage from "./routes/collection/CollectionPage";

import "@google/model-viewer";

/* Assistant */
import "./assistant/standalone";

/* Boot */
import Boot from "./routes/boot/Boot";
import { shouldShowBootOnce } from "./lib/bootGate";

import ErrorBoundary from "./components/_debug/ErrorBoundary";

/* ---------- Route-level error UI ---------- */
function RouteErrorPage() {
  const err = useRouteError();
  // eslint-disable-next-line no-console
  console.error("[RouteError]", err);

  let title = "Unexpected Application Error";
  let detail: string;

  if (isRouteErrorResponse(err)) {
    title = `${err.status} ${err.statusText}`;
    detail = typeof err.data === "string" ? err.data : JSON.stringify(err.data);
  } else if (err instanceof Error) {
    detail = err.message + (err.stack ? `\n\n${err.stack}` : "");
  } else {
    detail = String(err);
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-2">{title}</h1>
      <pre className="text-xs whitespace-pre-wrap">{detail}</pre>
    </div>
  );
}

/* ---------- Global media guard (pause/mute on route change) ---------- */
function GlobalMediaGuard() {
  const loc = useLocation();
  useEffect(() => {
    const media = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[];
    media.forEach((m) => {
      try {
        m.pause();
        m.muted = true;
      } catch {}
    });
  }, [loc.pathname, loc.search, loc.hash]);
  return null;
}

/* ---------- Gate: require Boot once per *site* version ---------- */
function RequireBootGate() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const needBoot = shouldShowBootOnce("site"); // localStorage + BOOT_VERSION
    const onBoot = loc.pathname === "/";
    if (needBoot && !onBoot) {
      nav("/", { replace: true });
    }
  }, [loc.pathname, nav]);

  return <Outlet />;
}

/* ---------- App layout (behind gate) ---------- */
function AppLayout() {
  return (
    <>
      <GlobalMediaGuard />
      <Topbar />
      <Sidebar />
      <div className="pl-14">
        <Outlet />
      </div>
    </>
  );
}

/* ---------- Router ---------- */
const router = createBrowserRouter([
  { path: "/", element: <Boot /> },
  {
    path: "/",
    element: <RequireBootGate />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/home", element: <AppLayout />, children: [{ index: true, element: <Home /> }] },
      { path: "/explore", element: <AppLayout />, children: [{ index: true, element: <Explore /> }] },

      // ✅ Discover route
      { path: "/discover", element: <AppLayout />, children: [{ index: true, element: <DiscoverPage /> }] },

      // Auth-protected
      { path: "/contracts", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><Contracts /></RequireAuth> }] },
      { path: "/contracts/:id", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><RequestDetail /></RequireAuth> }] },
      { path: "/account", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><Account /></RequireAuth> }] },
      { path: "/create", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><CreateArtwork /></RequireAuth> }] },
      { path: "/studio", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><StudioHome /></RequireAuth> }] },
      { path: "/studio/create", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><CreateChooser /></RequireAuth> }] },
      { path: "/studio/create/collection", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><DeployCollection /></RequireAuth> }] },
      { path: "/studio/create/collection/deploying", element: <AppLayout />, children: [{ index: true, element: <RequireAuth><Deploying /></RequireAuth> }] },

      // Public
      { path: "/u/:handle", element: <AppLayout />, children: [{ index: true, element: <PublicProfile /> }] },
      { path: "/art/:id", element: <AppLayout />, children: [{ index: true, element: <ArtworkDetail /> }] },
      { path: "/art/:id/ar", element: <AppLayout />, children: [{ index: true, element: <ARPreview /> }] },
      { path: "/checkout/success", element: <AppLayout />, children: [{ index: true, element: <CheckoutSuccess /> }] },
      { path: "/orders/success", element: <AppLayout />, children: [{ index: true, element: <CheckoutSuccess /> }] },
      { path: "/signin", element: <AppLayout />, children: [{ index: true, element: <SignIn /> }] },
      { path: "/auth/callback", element: <AppLayout />, children: [{ index: true, element: <Callback /> }] },

      // Collections
      { path: "/collection/:slug", element: <AppLayout />, children: [{ index: true, element: <CollectionPage /> }] },
      { path: "/collection/:slug/edit", element: <AppLayout />, children: [{ index: true, element: <CollectionEdit /> }] },

      { path: "*", element: <Navigate to="/home" replace /> },
    ],
  },
]);

const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
