import React, { useEffect, useState } from 'react';
import { Button, Table, Modal, Form, Input, Checkbox, message, Popconfirm } from 'antd';
import { request } from '@/utils/http';
import config from '@/utils/config';

const RoleManage = () => {
  const [data, setData] = useState<any[]>([]);
  const [allKeys, setAllKeys] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => {
    const res = await request.get(`${config.apiPrefix}roles`);
    if (res.code === 200) {
      setData(res.data || []);
      setAllKeys((res as any).allPageKeys || []);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setVisible(true);
  };
  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ name: r.name, description: r.description, pageKeys: r.pageKeys || [] });
    setVisible(true);
  };

  const onSubmit = async () => {
    const v = await form.validateFields();
    const res = editing
      ? await request.put(`${config.apiPrefix}roles/${editing.id}`, v)
      : await request.post(`${config.apiPrefix}roles`, v);
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

  const onDelete = async (r: any) => {
    const res = await request.delete(`${config.apiPrefix}roles/${r.id}`);
    if (res.code === 200) {
      message.success('已删除');
      load();
    } else {
      message.error(res.message || '删除失败');
    }
  };

  const columns = [
    { title: '角色', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description' },
    {
      title: '页面权限',
      dataIndex: 'pageKeys',
      render: (k: string[]) => (k || []).join(', '),
    },
    {
      title: '操作',
      render: (_: any, r: any) => (
        <>
          <a onClick={() => openEdit(r)}>编辑</a>
          {r.isBuiltin !== 1 && (
            <Popconfirm title="确认删除该角色？" onConfirm={() => onDelete(r)}>
              <a style={{ marginLeft: 8 }}>删除</a>
            </Popconfirm>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" onClick={openCreate}>
        新建角色
      </Button>
      <Table rowKey="id" columns={columns} dataSource={data} style={{ marginTop: 16 }} />
      <Modal
        title={editing ? '编辑角色' : '新建角色'}
        open={visible}
        onOk={onSubmit}
        onCancel={() => {
          setVisible(false);
          setEditing(null);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input />
          </Form.Item>
          <Form.Item name="pageKeys" label="可访问页面" rules={[{ required: true }]}>
            <Checkbox.Group options={allKeys.map((k) => ({ label: k, value: k }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default RoleManage;
