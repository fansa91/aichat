import { jsx as _jsx } from "react/jsx-runtime";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ChatProvider } from "./context/ChatContext";
import { AuthPage } from "./pages/AuthPage";
import { ChatPage } from "./pages/ChatPage";
import { Skeleton } from "./components/ui/misc";
function Shell() {
    const { user, loading } = useAuth();
    if (loading) {
        return (_jsx("div", { className: "flex h-screen items-center justify-center", children: _jsx(Skeleton, { className: "h-8 w-48" }) }));
    }
    if (!user)
        return _jsx(AuthPage, {});
    return (_jsx(ChatProvider, { children: _jsx(ChatPage, {}) }));
}
export default function App() {
    return (_jsx(AuthProvider, { children: _jsx(Shell, {}) }));
}
