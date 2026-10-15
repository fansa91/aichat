import { jsx as _jsx } from "react/jsx-runtime";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../AuthContext";
import { AuthPage } from "../../pages/AuthPage";
vi.mock("../../lib/api", () => ({
    api: {
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        me: vi.fn(),
    },
    ApiError: class ApiError extends Error {
        status;
        code;
        constructor(status, code, message) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
}));
import { api } from "../../lib/api";
describe("AuthPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });
    it("登录成功后存 token", async () => {
        const user = userEvent.setup();
        vi.mocked(api.login).mockResolvedValue({ token: "tok123", user: { id: "u1", username: "e2e" } });
        render(_jsx(AuthProvider, { children: _jsx(AuthPage, {}) }));
        await user.type(screen.getByLabelText("用户名"), "e2e");
        await user.type(screen.getByLabelText("密码"), "password123");
        await user.click(screen.getByRole("button", { name: "登录" }));
        await waitFor(() => expect(api.login).toHaveBeenCalledWith("e2e", "password123"));
        await waitFor(() => expect(localStorage.getItem("aichat_token")).toBe("tok123"));
    });
    it("登录失败显示错误信息", async () => {
        const user = userEvent.setup();
        const { ApiError } = await import("../../lib/api");
        vi.mocked(api.login).mockRejectedValue(new ApiError(401, "bad_credentials", "用户名或密码错误"));
        render(_jsx(AuthProvider, { children: _jsx(AuthPage, {}) }));
        await user.type(screen.getByLabelText("用户名"), "e2e");
        await user.type(screen.getByLabelText("密码"), "wrong");
        await user.click(screen.getByRole("button", { name: "登录" }));
        await waitFor(() => expect(screen.getByText("用户名或密码错误")).toBeTruthy());
        expect(localStorage.getItem("aichat_token")).toBeNull();
    });
});
