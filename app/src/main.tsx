import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";

import { AuthProvider } from "./routes/_auth/AuthContext";
import RequireAuth from "./routes/_auth/RequireAuth";

import Navbar from "./components/Navbar";
import Home from "./routes/home/Home";
import Account from "./routes/account/Account";
import CreateArtwork from "./routes/create/CreateArtwork";
import Explore from "./routes/explore/Explore";
import Contracts from "./routes/contracts/Contracts";
import SignIn from "./routes/_auth/SignIn";
import Callback from "./routes/_auth/Callback";
import PublicProfile from "./routes/profiles/PublicProfile";
import ArtworkDetail from "./routes/art/ArtworkDetail";

// NEW:
import StudioHome from "./routes/studio/StudioHome";
import CreateChooser from "./routes/studio/CreateChooser";

function Layout() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/explore", element: <Explore /> },
      { path: "/contracts", element: <Contracts /> },

      // Auth pages
      { path: "/signin", element: <SignIn /> },
      { path: "/auth/callback", element: <Callback /> },

      // Protected
      { path: "/account", element: <RequireAuth><Account /></RequireAuth> },
      { path: "/create", element: <RequireAuth><CreateArtwork /></RequireAuth> },

      // NEW: Studio & Create chooser (protected like OpenSea Studio)
      { path: "/studio", element: <RequireAuth><StudioHome /></RequireAuth> },
      { path: "/studio/create", element: <RequireAuth><CreateChooser /></RequireAuth> },

      // Public profile
      { path: "/u/:handle", element: <PublicProfile /> },

      { path: "/art/:id", element: <ArtworkDetail /> },
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
