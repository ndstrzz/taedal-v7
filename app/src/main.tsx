// app/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";

import { AuthProvider } from "./routes/_auth/AuthContext";
import RequireAuth from "./routes/_auth/RequireAuth";

// Global chrome
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

// Core routes
import Home from "./routes/home/Home";
import Explore from "./routes/explore/Explore";
import Contracts from "./routes/contracts/Contracts";
import PublicProfile from "./routes/profiles/PublicProfile";
import ArtworkDetail from "./routes/art/ArtworkDetail";

// Auth routes
import SignIn from "./routes/_auth/SignIn";
import Callback from "./routes/_auth/Callback";
import Account from "./routes/account/Account";

// Create/Mint flow
import CreateArtwork from "./routes/create/CreateArtwork";

// Studio UI
import StudioHome from "./routes/studio/StudioHome";
import CreateChooser from "./routes/studio/CreateChooser";
import DeployCollection from "./routes/studio/DeployCollection";
import Deploying from "./routes/studio/Deploying";

// ✅ Checkout success page
import CheckoutSuccess from "./routes/checkout/Success";

function Layout() {
  return (
    <>
      <Topbar />
      <Sidebar />
      {/* push content to the right of the 56px rail */}
      <div className="pl-14">
        <Outlet />
      </div>
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      // Public
      { path: "/", element: <Home /> },
      { path: "/explore", element: <Explore /> },
      { path: "/contracts", element: <Contracts /> },
      { path: "/u/:handle", element: <PublicProfile /> },
      { path: "/art/:id", element: <ArtworkDetail /> },

      // ✅ Stripe success routes (both paths supported)
      { path: "/checkout/success", element: <CheckoutSuccess /> },
      { path: "/orders/success", element: <CheckoutSuccess /> },

      // Auth
      { path: "/signin", element: <SignIn /> },
      { path: "/auth/callback", element: <Callback /> },

      // Protected
      { path: "/account", element: <RequireAuth><Account /></RequireAuth> },
      { path: "/create", element: <RequireAuth><CreateArtwork /></RequireAuth> },

      // Studio (protected, UI-first)
      { path: "/studio", element: <RequireAuth><StudioHome /></RequireAuth> },
      { path: "/studio/create", element: <RequireAuth><CreateChooser /></RequireAuth> },
      { path: "/studio/create/collection", element: <RequireAuth><DeployCollection /></RequireAuth> },
      { path: "/studio/create/collection/deploying", element: <RequireAuth><Deploying /></RequireAuth> },
    ],
  },
]);

const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
