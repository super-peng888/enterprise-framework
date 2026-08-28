-- =============================================================
-- framework-system 数据库初始化脚本（PostgreSQL 16）
-- 单租户：全库数据共享，无 tenant_id；数据权限由 @DataScope 五档控制。
-- 全部语句幂等（IF NOT EXISTS / WHERE NOT EXISTS），随服务启动执行。
-- 注意：sys_audit_log / sys_login_log 数据量增长快，后期建议：
--   1) 按月做声明式分区 PARTITION BY RANGE (created_at)；
--   2) 历史分区定期归档/清理；本期为单表实现。
-- =============================================================

CREATE TABLE IF NOT EXISTS sys_dept (
    id              BIGSERIAL PRIMARY KEY,
    parent_id       BIGINT       NOT NULL DEFAULT 0,
    name            VARCHAR(128) NOT NULL,
    feishu_dept_id  VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_user (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    real_name       VARCHAR(64),
    feishu_union_id VARCHAR(64)  UNIQUE,
    feishu_open_id  VARCHAR(64),
    dept_id         BIGINT,
    -- 1 在职/启用，0 离职/禁用
    status          SMALLINT     NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 账号密码登录：BCrypt 哈希；存量库幂等补列
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS password VARCHAR(100);

CREATE TABLE IF NOT EXISTS sys_role (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(64) NOT NULL UNIQUE,
    name        VARCHAR(64) NOT NULL,
    -- 数据范围五档：ALL 全部 / DEPT_AND_CHILD 本部门及以下 / DEPT 本部门 / SELF 本人 / CUSTOM 自定义部门
    data_scope  VARCHAR(32) NOT NULL DEFAULT 'SELF',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CUSTOM 档自定义部门 ID 集合（JSON 数组）；存量库幂等补列
ALTER TABLE sys_role ADD COLUMN IF NOT EXISTS dept_ids JSONB;

COMMENT ON COLUMN sys_role.data_scope IS '数据范围五档：ALL 全部 / DEPT_AND_CHILD 本部门及以下 / DEPT 本部门 / SELF 本人 / CUSTOM 自定义部门（dept_ids）';

CREATE TABLE IF NOT EXISTS sys_user_role (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sys_menu (
    id         BIGSERIAL PRIMARY KEY,
    parent_id  BIGINT       NOT NULL DEFAULT 0,
    title      VARCHAR(64)  NOT NULL,
    -- dir 目录 / menu 菜单 / button 按钮（权限点）
    type       VARCHAR(16)  NOT NULL DEFAULT 'menu',
    path       VARCHAR(255),
    icon       VARCHAR(64),
    perm       VARCHAR(128),
    sort       INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sys_role_menu (
    role_id BIGINT NOT NULL,
    menu_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, menu_id)
);

CREATE TABLE IF NOT EXISTS sys_login_log (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT,
    username   VARCHAR(64),
    ip         VARCHAR(64),
    user_agent VARCHAR(512),
    success    BOOLEAN     NOT NULL DEFAULT FALSE,
    message    VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_audit_log (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT,
    username   VARCHAR(64),
    module     VARCHAR(64),
    action     VARCHAR(64),
    biz_id     VARCHAR(64),
    detail     JSONB,
    trace_id   VARCHAR(64),
    ip         VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sys_login_log_created ON sys_login_log (created_at);
CREATE INDEX IF NOT EXISTS idx_sys_audit_log_created ON sys_audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_sys_audit_log_trace ON sys_audit_log (trace_id);

-- =============================================================
-- 种子数据：示例部门 + 角色 + 用户 + 系统管理菜单（幂等）
-- 角色：ADMIN 平台超管(ALL) / DEPT_LEADER 部门负责人(DEPT) / EMPLOYEE 普通员工(SELF)
-- 用户：admin(系统管理员) / zhangsan(张三,研发部,部门负责人) / lisi(李四,市场部,普通员工)
-- =============================================================

INSERT INTO sys_dept (parent_id, name)
SELECT 0, '总经理办公室'
WHERE NOT EXISTS (SELECT 1 FROM sys_dept WHERE name = '总经理办公室');

INSERT INTO sys_dept (parent_id, name)
SELECT 0, '研发部'
WHERE NOT EXISTS (SELECT 1 FROM sys_dept WHERE name = '研发部');

INSERT INTO sys_dept (parent_id, name)
SELECT 0, '市场部'
WHERE NOT EXISTS (SELECT 1 FROM sys_dept WHERE name = '市场部');

INSERT INTO sys_role (code, name, data_scope)
SELECT 'ADMIN', '平台超管', 'ALL'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE code = 'ADMIN');

INSERT INTO sys_role (code, name, data_scope)
SELECT 'DEPT_LEADER', '部门负责人', 'DEPT'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE code = 'DEPT_LEADER');

INSERT INTO sys_role (code, name, data_scope)
SELECT 'EMPLOYEE', '普通员工', 'SELF'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE code = 'EMPLOYEE');

INSERT INTO sys_user (username, real_name, dept_id, status)
SELECT 'admin', '系统管理员', (SELECT id FROM sys_dept WHERE name = '总经理办公室' LIMIT 1), 1
WHERE NOT EXISTS (SELECT 1 FROM sys_user WHERE username = 'admin');

INSERT INTO sys_user (username, real_name, dept_id, status)
SELECT 'zhangsan', '张三', (SELECT id FROM sys_dept WHERE name = '研发部' LIMIT 1), 1
WHERE NOT EXISTS (SELECT 1 FROM sys_user WHERE username = 'zhangsan');

INSERT INTO sys_user (username, real_name, dept_id, status)
SELECT 'lisi', '李四', (SELECT id FROM sys_dept WHERE name = '市场部' LIMIT 1), 1
WHERE NOT EXISTS (SELECT 1 FROM sys_user WHERE username = 'lisi');

INSERT INTO sys_user_role (user_id, role_id)
SELECT u.id, r.id
FROM sys_user u, sys_role r
WHERE u.username = 'admin' AND r.code = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id AND ur.role_id = r.id);

INSERT INTO sys_user_role (user_id, role_id)
SELECT u.id, r.id
FROM sys_user u, sys_role r
WHERE u.username = 'zhangsan' AND r.code = 'DEPT_LEADER'
  AND NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id AND ur.role_id = r.id);

INSERT INTO sys_user_role (user_id, role_id)
SELECT u.id, r.id
FROM sys_user u, sys_role r
WHERE u.username = 'lisi' AND r.code = 'EMPLOYEE'
  AND NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id AND ur.role_id = r.id);

-- 菜单种子：path 约定为前端组件地址（相对 frontend/src/pages，如 system/users/Users.tsx），
-- 前端动态路由取组件地址所在目录作为路由路径（system/users/Users.tsx → /system/users）。
-- 全部语句幂等：按 title+type 判重。
INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT 0, '工作台', 'dir', NULL, 'LayoutDashboard', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '工作台' AND type = 'dir');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT 0, '审批管理', 'dir', NULL, 'Workflow', NULL, 2
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '审批管理' AND type = 'dir');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT 0, '系统管理', 'dir', NULL, 'Settings', NULL, 3
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '系统管理' AND type = 'dir');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '工作台' AND type = 'dir' LIMIT 1),
       '仪表盘', 'menu', 'dashboard/Dashboard.tsx', 'LayoutDashboard', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '仪表盘' AND type = 'menu');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '工作台' AND type = 'dir' LIMIT 1),
       '发起审批', 'menu', 'approval/launch/Launch.tsx', 'Send', NULL, 2
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '发起审批' AND type = 'menu');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '工作台' AND type = 'dir' LIMIT 1),
       '审批中心', 'menu', 'approval/center/ApprovalCenter.tsx', 'ListChecks', NULL, 3
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '审批中心' AND type = 'menu');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '审批管理' AND type = 'dir' LIMIT 1),
       '流程设计', 'menu', 'approval/designer/FlowDesigner.tsx', 'Workflow', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '流程设计' AND type = 'menu');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '审批管理' AND type = 'dir' LIMIT 1),
       '表单中心', 'menu', 'approval/forms/FormCenter.tsx', 'ClipboardList', NULL, 2
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '表单中心' AND type = 'menu');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '系统管理' AND type = 'dir' LIMIT 1),
       '用户管理', 'menu', 'system/users/Users.tsx', 'UserCog', 'system:user:list', 1
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE perm = 'system:user:list');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '系统管理' AND type = 'dir' LIMIT 1),
       '角色权限', 'menu', 'system/roles/Roles.tsx', 'ShieldCheck', 'system:role:list', 2
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE perm = 'system:role:list');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '系统管理' AND type = 'dir' LIMIT 1),
       '菜单管理', 'menu', 'system/menus/Menus.tsx', 'ListTree', 'system:menu:list', 3
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE perm = 'system:menu:list');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE title = '系统管理' AND type = 'dir' LIMIT 1),
       '审计日志', 'menu', 'system/audit-logs/AuditLogs.tsx', 'History', NULL, 4
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE title = '审计日志' AND type = 'menu');

-- 按钮型权限点示例（挂在用户管理菜单下）
INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE perm = 'system:user:list' LIMIT 1),
       '新增用户', 'button', NULL, NULL, 'system:user:add', 1
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE perm = 'system:user:add');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE perm = 'system:user:list' LIMIT 1),
       '编辑用户', 'button', NULL, NULL, 'system:user:edit', 2
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE perm = 'system:user:edit');

INSERT INTO sys_menu (parent_id, title, type, path, icon, perm, sort)
SELECT (SELECT id FROM sys_menu WHERE perm = 'system:user:list' LIMIT 1),
       '删除用户', 'button', NULL, NULL, 'system:user:delete', 3
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE perm = 'system:user:delete');

-- ADMIN 角色授予全部菜单
INSERT INTO sys_role_menu (role_id, menu_id)
SELECT (SELECT id FROM sys_role WHERE code = 'ADMIN'), m.id
FROM sys_menu m
WHERE NOT EXISTS (
    SELECT 1 FROM sys_role_menu rm
    WHERE rm.role_id = (SELECT id FROM sys_role WHERE code = 'ADMIN') AND rm.menu_id = m.id
);

-- =============================================================
-- 审批引擎（动态表单 + 树形 JSON 流程 + 轻量状态机）
-- 全部语句幂等，随服务启动执行。
-- =============================================================

-- 动态表单定义：schema 为 Formily JSON Schema
CREATE TABLE IF NOT EXISTS form_definition (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(128) NOT NULL,
    schema     JSONB        NOT NULL,
    status     VARCHAR(16)  NOT NULL DEFAULT '启用', -- 启用/停用
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 编码：全局唯一，供前端任意页面按 code 引用；存量库幂等补列
ALTER TABLE form_definition ADD COLUMN IF NOT EXISTS code VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uk_form_definition_code ON form_definition (code);

-- 流程定义：flow_json 为树形节点
-- {nodes:[{type:'approver'|'cc'|'condition', name,
--          approverType:[member/role/deptLeader], approvers text[], signMode:[or/all],
--          ccUsers text[],
--          branches:[{name,isDefault,conditions:[{field,op,value}],children:[...]}]}]}
CREATE TABLE IF NOT EXISTS flow_definition (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(128) NOT NULL,
    flow_json  JSONB        NOT NULL,
    status     VARCHAR(16)  NOT NULL DEFAULT '启用', -- 启用/停用
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 流程绑定表单（表单中心 form_definition.id），保存流程时自动维护审批模板
ALTER TABLE flow_definition ADD COLUMN IF NOT EXISTS form_id BIGINT;
-- 种子流程绑定种子表单
UPDATE flow_definition SET form_id = (SELECT id FROM form_definition WHERE code = 'LEAVE_APPLY')
WHERE name = '请假审批流程' AND form_id IS NULL;

-- 审批模板：绑定表单 + 流程，业务方按 code 发起
CREATE TABLE IF NOT EXISTS approval_template (
    id         BIGSERIAL PRIMARY KEY,
    code       VARCHAR(64)  NOT NULL UNIQUE,
    name       VARCHAR(128) NOT NULL,
    form_id    BIGINT       NOT NULL,
    flow_id    BIGINT       NOT NULL,
    status     VARCHAR(16)  NOT NULL DEFAULT '启用',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 审批实例
CREATE TABLE IF NOT EXISTS approval_instance (
    id                BIGSERIAL PRIMARY KEY,
    template_id       BIGINT       NOT NULL,
    title             VARCHAR(255) NOT NULL,
    business_key      VARCHAR(128),
    form_data         JSONB,
    status            VARCHAR(16)  NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED/CANCELED/RETURNED（退回发起人，等重新提交）
    current_node_path VARCHAR(255),
    initiator_id      BIGINT,
    initiator_name    VARCHAR(64),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_instance_biz ON approval_instance (business_key);
CREATE INDEX IF NOT EXISTS idx_approval_instance_status ON approval_instance (status);
-- 流程版本快照：实例创建时冻结 flow_definition.flow_json，引擎所有展开（推进/进度/驳回回退/resubmit）
-- 一律按快照求值，设计器后续修改流程定义不影响在途实例；resubmit 也沿用原快照（按发起时的流程版本走）
ALTER TABLE approval_instance ADD COLUMN IF NOT EXISTS flow_snapshot JSONB;
-- 表单版本快照：实例创建时冻结 form_definition.schema，实例详情回显一律按快照，
-- 表单设计器后续修改表单定义不影响在途实例；resubmit 沿用原快照（按发起时的表单版本回显）
ALTER TABLE approval_instance ADD COLUMN IF NOT EXISTS form_snapshot JSONB;

-- 审批任务（approver 生成 PENDING 任务；cc 生成已完成的 CC 记录，不阻塞流程）
CREATE TABLE IF NOT EXISTS approval_task (
    id           BIGSERIAL PRIMARY KEY,
    instance_id  BIGINT      NOT NULL,
    node_id      VARCHAR(64) NOT NULL,
    node_name    VARCHAR(128),
    node_type    VARCHAR(16) NOT NULL,           -- approver/cc
    assignee_name VARCHAR(64),
    sign_mode    VARCHAR(8),                     -- or/all（仅 approver 节点）
    status       VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED/CC/WAITING（被前加签挂起）/CANCELED（被回退作废）
    comment      VARCHAR(512),
    acted_at     TIMESTAMPTZ,
    sort         INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_approval_task_instance ON approval_task (instance_id);
CREATE INDEX IF NOT EXISTS idx_approval_task_assignee ON approval_task (assignee_name, status);

-- 加签（前加签/后加签）支持：origin 标记任务来源，parent_task_id 指向被加签的原任务；
-- status 增加 WAITING 语义（被前加签挂起的原任务），不加 CHECK 约束，由代码层控制
ALTER TABLE approval_task ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE approval_task ADD COLUMN IF NOT EXISTS parent_task_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_approval_task_parent ON approval_task (parent_task_id);

-- =============================================================
-- 审批演示种子：请假申请表单 + 请假审批流程 + 模板 LEAVE
-- 链路：部门负责人审批(role DEPT_LEADER) → 条件分支[天数>3 → 总经理审批(member 张三)；
--       其他默认空分支] → 抄送李四
-- =============================================================

-- 请假申请表单（Formily JSON Schema），全局 code=LEAVE_APPLY
INSERT INTO form_definition (code, name, schema, status)
SELECT 'LEAVE_APPLY', '请假申请', '{
  "type": "object",
  "properties": {
    "leaveType": {"type": "string", "title": "请假类型", "x-decorator": "FormItem", "x-component": "Select", "enum": [{"label": "事假", "value": "事假"}, {"label": "病假", "value": "病假"}, {"label": "年假", "value": "年假"}, {"label": "调休", "value": "调休"}], "required": true},
    "startDate": {"type": "string", "title": "开始日期", "x-decorator": "FormItem", "x-component": "DatePicker", "required": true},
    "endDate": {"type": "string", "title": "结束日期", "x-decorator": "FormItem", "x-component": "DatePicker", "required": true},
    "days": {"type": "number", "title": "天数", "x-decorator": "FormItem", "x-component": "NumberPicker", "required": true},
    "reason": {"type": "string", "title": "事由", "x-decorator": "FormItem", "x-component": "TextArea"}
  }
}'::jsonb, '启用'
WHERE NOT EXISTS (SELECT 1 FROM form_definition WHERE name = '请假申请');

-- 存量种子回填 code（老库已有「请假申请」但没有 code 的场景）
UPDATE form_definition SET code = 'LEAVE_APPLY' WHERE name = '请假申请' AND code IS NULL;

-- 请假审批流程：部门负责人审批(role) → 条件分支[days>3 → 总经理审批(member 张三)；默认空分支] → 抄送(cc 李四)
INSERT INTO flow_definition (name, flow_json, status)
SELECT '请假审批流程', '{
  "nodes": [
    {"type": "approver", "name": "部门负责人审批", "approverType": "role", "approvers": ["DEPT_LEADER"], "signMode": "or"},
    {"type": "condition", "name": "请假天数判断", "branches": [
      {"name": "天数>3", "isDefault": false,
       "conditions": [{"field": "days", "op": ">", "value": 3}],
       "children": [
         {"type": "approver", "name": "总经理审批", "approverType": "member", "approvers": ["张三"], "signMode": "or"}
       ]},
      {"name": "其他", "isDefault": true, "conditions": [], "children": []}
    ]},
    {"type": "cc", "name": "抄送", "ccUsers": ["李四"]}
  ]
}'::jsonb, '启用'
WHERE NOT EXISTS (SELECT 1 FROM flow_definition WHERE name = '请假审批流程');

-- 模板：LEAVE 绑定请假申请表单 + 请假审批流程
INSERT INTO approval_template (code, name, form_id, flow_id, status)
SELECT 'LEAVE', '请假审批',
       (SELECT id FROM form_definition WHERE name = '请假申请' LIMIT 1),
       (SELECT id FROM flow_definition WHERE name = '请假审批流程' LIMIT 1),
       '启用'
WHERE NOT EXISTS (SELECT 1 FROM approval_template WHERE code = 'LEAVE');


-- =============================================================
-- 通知中心 notification
-- 全部语句幂等，随服务启动执行。
-- =============================================================

CREATE TABLE IF NOT EXISTS notification (
    id         BIGSERIAL PRIMARY KEY,
    user_name  VARCHAR(64)  NOT NULL,                -- 接收人姓名（real_name 口径）
    type       VARCHAR(16)  NOT NULL,                -- APPROVAL/CC/SYSTEM 等，业务方可扩展
    title      VARCHAR(255) NOT NULL,
    content    TEXT,
    biz_key    VARCHAR(128),                         -- 业务定位键，如 approval:7
    is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notification (user_name, is_read);
CREATE INDEX IF NOT EXISTS idx_notification_created ON notification (created_at);

-- =============================================================
-- 账号密码登录：种子用户统一初始密码 123456（BCrypt 哈希），仅补空密码，幂等
-- =============================================================
UPDATE sys_user
SET password = '$2b$10$psCdYZw.uee3H9you.1LJ.90qhY7eJT1j3EKXLiZksUOWc7owuvv2'
WHERE username IN ('admin', 'zhangsan', 'lisi')
  AND password IS NULL;
