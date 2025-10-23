// app/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  useRouteError,
  isRouteErrorResponse,
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
import Contracts from "./routes/contracts/Contracts";
import RequestDetail from "./routes/contracts/RequestDetail";
import PublicProfile from "./routes/profiles/PublicProfile";
import ArtworkDetail from "./routes/art/ArtworkDetail";
import SignIn from "./routes/_auth/SignIn";
import Callback from "./routes/_auth/Callback";
import Account from "./routes/account/Account";
import CreateArtwork from "./routes/create/CreateArtwork";
import StudioHome from "./routes/studio/StudioHome";
import CreateChooser from "./routes/studio/CreateChooser";
import DeployCollection from "./routes/studio/DeployCollection";
import Deploying from "./routes/studio/Deploying";
import CheckoutSuccess from "./routes/checkout/Success";
import Discover from "./routes/discover/Discover";

/* Assistant always-on */
import "./assistant/standalone";

/* Optional global safety net (still useful for non-route errors) */
import ErrorBoundary from "./components/_debug/ErrorBoundary";

function Layout() {
  return (
    <>
      <Topbar />
      <Sidebar />
      <div className="pl-14">
        <Outlet />
      </div>
    </>
  );
}

/** Route-level error UI (this is what React Router will render) */
function RouteErrorPage() {
  const err = useRouteError();
  // Keep a console for quick diagnosis in prod (maps with sourcemaps)
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

const router = createBrowserRouter([
  {
    element: <Layout />,
    /** 👇 this catches render/loader/action errors in this branch */
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/discover", element: <Discover /> },
      { path: "/explore", element: <Explore /> },

      // 🔒 Auth-protected
      { path: "/contracts", element: <RequireAuth><Contracts /></RequireAuth> },
      { path: "/contracts/:id", element: <RequireAuth><RequestDetail /></RequireAuth> },
      { path: "/account", element: <RequireAuth><Account /></RequireAuth> },
      { path: "/create", element: <RequireAuth><CreateArtwork /></RequireAuth> },
      { path: "/studio", element: <RequireAuth><StudioHome /></RequireAuth> },
      { path: "/studio/create", element: <RequireAuth><CreateChooser /></RequireAuth> },
      { path: "/studio/create/collection", element: <RequireAuth><DeployCollection /></RequireAuth> },
      { path: "/studio/create/collection/deploying", element: <RequireAuth><Deploying /></RequireAuth> },

      // Public
      { path: "/u/:handle", element: <PublicProfile /> },
      { path: "/art/:id", element: <ArtworkDetail /> },
      { path: "/checkout/success", element: <CheckoutSuccess /> },
      { path: "/orders/success", element: <CheckoutSuccess /> },
      { path: "/signin", element: <SignIn /> },
      { path: "/auth/callback", element: <Callback /> },
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
