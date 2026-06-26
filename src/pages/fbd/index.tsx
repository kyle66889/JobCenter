import { SharedContext } from '@/layouts';
import config from '@/utils/config';
import { request } from '@/utils/http';
import { PageContainer } from '@ant-design/pro-layout';
import { useOutletContext } from '@umijs/max';
import {
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { ColumnProps } from 'antd/lib/table';
import React, { useEffect, useState } from 'react';

const STATUS_LABEL: Record<number, string> = {
  0: '待审批',
  1: '执行中',
  2: '已通过',
  3: '失败',
  4: '已拒绝',
};
const STATUS_COLOR: Record<number, string> = {
  0: 'orange',
  1: 'blue',
  2: 'green',
  3: 'red',
  4: 'default',
};

const FbdCenter = () => {
  const { headerStyle, user } = useOutletContext<SharedContext>();
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [detail, setDetail] = useState<any>(null);
  const isAdmin = !!user?.isAdmin;

  const getList = (opts?: { search?: string; pageNum?: number }) => {
    setLoading(true);
    const s = opts?.search !== undefined ? opts.search : searchText;
    const p = opts?.pageNum !== undefined ? opts.pageNum : page;
    const params = new URLSearchParams();
    if (s) params.set('searchValue', s);
    if (statusFilter !== undefined) params.set('status', String(statusFilter));
    params.set('page', String(p));
    params.set('size', String(size));
    request
      .get(`${config.apiPrefix}fbd/tasks?${params.toString()}`)
      .then(({ code, data }) => {
        if (code === 200) {
          setData(data?.data ?? []);
          setTotal(data?.total ?? 0);
        }
      })
      .catch(() => message.error('加载失败，请重试'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    getList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, statusFilter]);

  const handleApprove = (record: any) => {
    request
      .put(`${config.apiPrefix}fbd/tasks/${record.id}/approve`)
      .then(({ code, message: msg }) => {
        if (code === 200) {
          message.success('已审批');
          getList();
        } else {
          message.error(msg || '审批失败');
        }
      })
      .catch(() => message.error('网络错误，请重试'));
  };

  const handleReject = (record: any) => {
    request
      .put(`${config.apiPrefix}fbd/tasks/${record.id}/reject`)
      .then(({ code, message: msg }) => {
        if (code === 200) {
          message.success('已拒绝');
          getList();
        } else {
          message.error(msg || '操作失败');
        }
      })
      .catch(() => message.error('网络错误，请重试'));
  };

  const columns: ColumnProps<any>[] = [
    { title: '名称', dataIndex: 'title', key: 'title' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '来源', dataIndex: 'source', key: 'source' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: number) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>,
    },
    { title: '创建时间', dataIndex: 'timestamp', key: 'timestamp' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <a onClick={() => setDetail(record)}>查看</a>
          {isAdmin && record.status === 0 && (
            <>
              <Popconfirm
                title="确认通过并执行更新？"
                onConfirm={() => handleApprove(record)}
              >
                <a>通过</a>
              </Popconfirm>
              <Popconfirm title="确认拒绝？" onConfirm={() => handleReject(record)}>
                <a style={{ color: '#ff4d4f' }}>拒绝</a>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      className="ql-container-wrapper"
      title="FBD 中心"
      header={{ style: headerStyle }}
      extra={[
        <Select
          key="status"
          allowClear
          placeholder="状态筛选"
          style={{ width: 120 }}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={Object.keys(STATUS_LABEL).map((k) => ({
            value: Number(k),
            label: STATUS_LABEL[Number(k)],
          }))}
        />,
        <Input.Search
          key="search"
          placeholder="请输入名称或者关键词"
          style={{ width: 220 }}
          onSearch={(val) => {
            setSearchText(val);
            setPage(1);
            getList({ search: val, pageNum: 1 });
          }}
          onChange={(e) => setSearchText(e.target.value)}
        />,
      ]}
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          current: page,
          pageSize: size,
          total,
          onChange: (p, s) => {
            setPage(p);
            setSize(s);
          },
        }}
      />
      <Modal
        open={!!detail}
        title={detail?.title}
        footer={null}
        onCancel={() => setDetail(null)}
        width={640}
      >
        {detail && (
          <div>
            <p>类型：{detail.type}</p>
            <p>来源：{detail.source}</p>
            <p>状态：{STATUS_LABEL[detail.status]}</p>
            <p>操作人：{detail.operator || '-'}</p>
            <p>执行结果：{detail.result || '-'}</p>
            <p>数据 payload：</p>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                maxHeight: 360,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(detail.payload, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default FbdCenter;
