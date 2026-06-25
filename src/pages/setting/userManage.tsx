import React, { useEffect, useState } from 'react';
import { Button, Table, Modal, Form, Input, Select, Switch, message, Popconfirm } from 'antd';
import { request } from '@/utils/http';
import config from '@/utils/config';

const UserManage = () => {
  const [data, setData] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();

  const load = async () => {
    const [u, r] = await Promise.all([
      request.get(`${config.apiPrefix}users`),
      request.get(`${config.apiPrefix}roles`),
    ]);
    if (u.code === 200) setData(u.data || []);
    if (r.code === 200) setRoles(r.data || []);
  };
  useEffect(() => {
    load();
  }, []);

  const roleName = (id: number) => roles.find((x) => x.id === id)?.name || id;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setVisible(true);
  };
  const openEdit = (u: any) => {
    setEditing(u);
    form.setFieldsValue({
      nickname: u.nickname,
      email: u.email,
      isActive: u.isActive === 1,
      roleIds: u.roleIds || [],
    });
    setVisible(true);
  };

  const onSubmit = async () => {
    const v = await form.validateFields();
    let res;
    if (editing) {
      res = await request.put(`${config.apiPrefix}users/${editing.id}`, {
        nickname: v.nickname,
        email: v.email,
        isActive: v.isActive ? 1 : 0,
        roleIds: v.roleIds,
      });
    } else {
      res = await request.post(`${config.apiPrefix}users`, {
        username: v.username,
        password: v.password,
        nickname: v.nickname,
        email: v.email,
        roleIds: v.roleIds,
      });
    }
    if (res.code === 200) {
      message.success('已保存');
      setVisible(false);
      setEditing(null);
      form.resetFields();
      load();
    } else {
      message.error(res.message || '保存失败');
    }
  };

  const onResetPwd = async () => {
    const v = await pwdForm.validateFields();
    const res = await request.put(`${config.apiPrefix}users/${pwdTarget.id}/password`, {
      password: v.password,
    });
    if (res.code === 200) {
      message.success('密码已重置');
      setPwdVisible(false);
      setPwdTarget(null);
      pwdForm.resetFields();
    } else {
      message.error(res.message || '重置失败');
    }
  };

  const onDelete = async (u: any) => {
    const res = await request.delete(`${config.apiPrefix}users/${u.id}`);
    if (res.code === 200) {
      message.success('已删除');
      load();
    } else {
      message.error(res.message || '删除失败');
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username' },
    { title: '昵称', dataIndex: 'nickname' },
    {
      title: '角色',
      dataIndex: 'roleIds',
      render: (ids: number[]) => (ids || []).map(roleName).join(', '),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      render: (v: number) => (v === 1 ? '启用' : '禁用'),
    },
    {
      title: '操作',
      render: (_: any, u: any) => (
        <>
          <a onClick={() => openEdit(u)}>编辑</a>
          <a
            style={{ marginLeft: 8 }}
            onClick={() => {
              setPwdTarget(u);
              pwdForm.resetFields();
              setPwdVisible(true);
            }}
          >
            重置密码
          </a>
          <Popconfirm title="确认删除该用户？" onConfirm={() => onDelete(u)}>
            <a style={{ marginLeft: 8 }}>删除</a>
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" onClick={openCreate}>
        新建用户
      </Button>
      <Table rowKey="id" columns={columns} dataSource={data} style={{ marginTop: 16 }} />

      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        open={visible}
        onOk={onSubmit}
        onCancel={() => {
          setVisible(false);
          setEditing(null);
        }}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6 }]}>
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Form.Item name="nickname" label="昵称">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="roleIds" label="角色" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={roles.map((r) => ({ label: r.name, value: r.id }))}
            />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title="重置密码"
        open={pwdVisible}
        onOk={onResetPwd}
        onCancel={() => {
          setPwdVisible(false);
          setPwdTarget(null);
        }}
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default UserManage;
