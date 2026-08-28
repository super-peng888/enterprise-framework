# -*- coding: utf-8 -*-
"""一次性种子脚本：把 sys_menu 补齐为覆盖全部现有页面的菜单数据。
path 约定：组件地址（相对 frontend/src/pages，如 system/users/Users.tsx），路由路径取其目录名。
"""
import json
import os
import urllib.request

BASE = "http://localhost:8091"
TOKEN = os.environ["EF_TOKEN"]


def call(method, path, body=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def put(mid, body):
    r = call("PUT", f"/menus/{mid}", body)
    print("PUT", mid, r.get("success"), r.get("msg"))
    return r


def post(body):
    r = call("POST", "/menus", body)
    print("POST", body["title"], r.get("success"), (r.get("data") or {}).get("id"), r.get("msg"))
    return (r.get("data") or {}).get("id")


# --- 修正既有 4 条 ---
put(1, {"parentId": 0, "title": "系统管理", "type": "dir", "path": None, "icon": "Settings", "perm": None, "sort": 3})
put(2, {"parentId": 1, "title": "用户管理", "type": "menu", "path": "system/users/Users.tsx", "icon": "UserCog", "perm": "system:user:list", "sort": 1})
put(3, {"parentId": 1, "title": "角色权限", "type": "menu", "path": "system/roles/Roles.tsx", "icon": "ShieldCheck", "perm": "system:role:list", "sort": 2})
put(4, {"parentId": 1, "title": "菜单管理", "type": "menu", "path": "system/menus/Menus.tsx", "icon": "ListTree", "perm": "system:menu:list", "sort": 3})

# --- 工作台 ---
workbench = post({"parentId": 0, "title": "工作台", "type": "dir", "path": None, "icon": "LayoutDashboard", "perm": None, "sort": 1})
post({"parentId": workbench, "title": "仪表盘", "type": "menu", "path": "dashboard/Dashboard.tsx", "icon": "LayoutDashboard", "perm": None, "sort": 1})
post({"parentId": workbench, "title": "发起审批", "type": "menu", "path": "approval/launch/Launch.tsx", "icon": "Send", "perm": None, "sort": 2})
post({"parentId": workbench, "title": "审批中心", "type": "menu", "path": "approval/center/ApprovalCenter.tsx", "icon": "ListChecks", "perm": None, "sort": 3})

# --- 审批管理 ---
approval = post({"parentId": 0, "title": "审批管理", "type": "dir", "path": None, "icon": "Workflow", "perm": None, "sort": 2})
post({"parentId": approval, "title": "流程设计", "type": "menu", "path": "approval/designer/FlowDesigner.tsx", "icon": "Workflow", "perm": None, "sort": 1})
post({"parentId": approval, "title": "表单中心", "type": "menu", "path": "approval/forms/FormCenter.tsx", "icon": "ClipboardList", "perm": None, "sort": 2})

# --- 系统管理补充 ---
post({"parentId": 1, "title": "审计日志", "type": "menu", "path": "system/audit-logs/AuditLogs.tsx", "icon": "History", "perm": None, "sort": 4})
# 按钮型权限点示例（挂在用户管理下）
post({"parentId": 2, "title": "新增用户", "type": "button", "path": None, "icon": None, "perm": "system:user:add", "sort": 1})
post({"parentId": 2, "title": "编辑用户", "type": "button", "path": None, "icon": None, "perm": "system:user:edit", "sort": 2})
post({"parentId": 2, "title": "删除用户", "type": "button", "path": None, "icon": None, "perm": "system:user:delete", "sort": 3})

print("--- final ---")
print(json.dumps(call("GET", "/menus")["data"], ensure_ascii=False, indent=1))
