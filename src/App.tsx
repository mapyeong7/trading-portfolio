import AdminApp from "./components/AdminApp";
import PublicApp from "./components/PublicApp";

export default function App() {
  const isAdminPath = window.location.pathname.startsWith("/admin");
  return isAdminPath ? <AdminApp /> : <PublicApp />;
}
