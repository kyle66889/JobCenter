import { SharedContext } from '@/layouts';
import config from '@/utils/config';
import { request } from '@/utils/http';
import { PageContainer } from '@ant-design/pro-layout';
import { useOutletContext } from '@umijs/max';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
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

// 状态分类 Tab → 传给后端的 status（逗号分隔多状态）
const STATUS_TABS = [
  { key: 'pending', label: '待处理', status: '0,1' },
  { key: 'done', label: '已完成', status: '2' },
  { key: 'failed', label: '处理失败', status: '3,4' },
];

// 创建任务-类型预设；选「自定义」时显示文本框收任意值
const CUSTOM_TYPE = '__custom__';
const TYPE_OPTIONS = [
  { label: 'FedexFuelCharge', value: 'fedex_fuel_charge' },
  { label: 'Sql Monitor', value: 'sql_monitor' },
  { label: 'Fedex Zone', value: 'fedex_zone' },
  { label: '自定义', value: CUSTOM_TYPE },
];

// fedex_fuel_charge「详情」表格的行定义（类型 / 费率 / 生效日期）
const FUEL_DETAIL_ROWS = [
  { key: 'ground', name: 'FedEx Ground', rateKey: 'ground', effKey: 'ground_effective', mzlKey: 'ground' },
  {
    key: 'express',
    name: 'FedEx Express 国内包裹',
    rateKey: 'express_package',
    effKey: 'express_effective',
    mzlKey: 'express',
  },
  {
    key: 'freight_rate',
    name: 'Express Freight 单价',
    rateKey: 'express_freight_rate',
    effKey: 'express_effective',
    mzlKey: '',
  },
  {
    key: 'export_import',
    name: 'Express Freight 出口/进口',
    rateKey: 'export_import',
    effKey: 'export_import_effective',
    mzlKey: '',
  },
];

// 时间格式化：API 返回的 updatedAt 多为 ISO 串，转成本地可读；解析失败原样显示
const fmtTime = (s?: string) => {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
};

// 解析任务的 MZL_PriceID（对象或 JSON 字符串）为对象，失败返回 {}
const parseMzl = (v: any) => {
  let m = v;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      return {};
    }
  }
  return m && typeof m === 'object' ? m : {};
};

// 把 fedex_fuel_charge 的 payload + MZL_PriceID 整理成详情表格数据
// （每行带上对应的目标生产库行 id：Ground / Express 各一个，其余为空）
const fuelDetailRows = (payload: any, mzlRaw: any) => {
  let p = payload;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      return [];
    }
  }
  if (!p || typeof p !== 'object') return [];
  const mzl = parseMzl(mzlRaw);
  return FUEL_DETAIL_ROWS.filter((r) => p[r.rateKey]).map((r) => ({
    key: r.key,
    name: r.name,
    rate: p[r.rateKey],
    eff: p[r.effKey] || '-',
    mzl: r.mzlKey ? mzl[r.mzlKey] || '' : '',
  }));
};

const FbdCenter = () => {
  const { headerStyle, user } = useOutletContext<SharedContext>();
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [detail, setDetail] = useState<any>(null);
  const [detailMode, setDetailMode] = useState<'log' | 'detail'>('log');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [typeSel, setTypeSel] = useState<string | undefined>(undefined);
  const [form] = Form.useForm();
  const isAdmin = !!user?.isAdmin;

  const getList = (opts?: {
    search?: string;
    pageNum?: number;
    tab?: string;
  }) => {
    setLoading(true);
    const s = opts?.search !== undefined ? opts.search : searchText;
    const p = opts?.pageNum !== undefined ? opts.pageNum : page;
    const tabKey = opts?.tab !== undefined ? opts.tab : activeTab;
    const statusGroup = STATUS_TABS.find((t) => t.key === tabKey)?.status;
    const params = new URLSearchParams();
    if (s) params.set('searchValue', s);
    if (statusGroup) params.set('status', statusGroup);
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

  const getCounts = (search?: string) => {
    const s = search !== undefined ? search : searchText;
    const params = new URLSearchParams();
    if (s) params.set('searchValue', s);
    request
      .get(`${config.apiPrefix}fbd/tasks/stats?${params.toString()}`)
      .then(({ code, data }) => {
        if (code === 200) setCounts(data || {});
      })
      .catch(() => {});
  };

  useEffect(() => {
    getList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, activeTab]);

  useEffect(() => {
    getCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = (record: any) => {
    request
      .put(`${config.apiPrefix}fbd/tasks/${record.id}/approve`)
      .then(({ code, message: msg }) => {
        if (code === 200) {
          message.success('已审批');
          getList();
          getCounts();
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
          getCounts();
        } else {
          message.error(msg || '操作失败');
        }
      })
      .catch(() => message.error('网络错误，请重试'));
  };

  const openDetail = (record: any, mode: 'log' | 'detail') => {
    setDetailMode(mode);
    setDetail(record);
  };

  const openCreate = () => {
    form.resetFields();
    setTypeSel(undefined);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败，antd 已高亮
    }
    // payload：选填，填了必须是合法 JSON
    let payloadObj: any = {};
    if (values.payload && String(values.payload).trim()) {
      try {
        payloadObj = JSON.parse(values.payload);
      } catch {
        message.error('payload 不是合法 JSON');
        return;
      }
    }
    const type =
      values.type === CUSTOM_TYPE
        ? String(values.customType || '').trim()
        : values.type;
    if (!type) {
      message.error('请填写自定义类型');
      return;
    }
    setCreating(true);
    request
      .post(`${config.apiPrefix}fbd/tasks`, {
        title: values.title,
        type,
        source: String(values.source || '').trim() || 'manual',
        payload: payloadObj,
      })
      .then(({ code, message: msg }) => {
        if (code === 200) {
          message.success('已创建');
          setCreateOpen(false);
          // 新建恒为待审批 → 跳「待处理」并刷新
          setActiveTab('pending');
          setPage(1);
          getList({ tab: 'pending', pageNum: 1 });
          getCounts();
        } else {
          message.error(msg || '创建失败');
        }
      })
      .catch(() => message.error('网络错误，请重试'))
      .finally(() => setCreating(false));
  };

  const columns: ColumnProps<any>[] = [
    {
      title: '名称',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: any) => (
        <Space>
          <span>{title}</span>
          {record.type === 'fedex_fuel_charge' && (
            <a onClick={() => openDetail(record, 'detail')}>详情</a>
          )}
        </Space>
      ),
    },
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
          <a onClick={() => openDetail(record, 'log')}>
            {record.type === 'fedex_fuel_charge' ? '日志' : '查看'}
          </a>
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

  const tableNode = (
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
  );

  return (
    <PageContainer
      className="ql-container-wrapper ql-container-wrapper-has-tab"
      title="FBD 中心"
      header={{ style: headerStyle }}
      extra={[
        <Input.Search
          key="search"
          placeholder="请输入名称或者关键词"
          style={{ width: 220 }}
          onSearch={(val) => {
            setSearchText(val);
            setPage(1);
            getList({ search: val, pageNum: 1 });
            getCounts(val);
          }}
          onChange={(e) => setSearchText(e.target.value)}
        />,
        <Button key="create" type="primary" onClick={openCreate}>
          创建任务
        </Button>,
      ]}
    >
      <div style={{ height: '100%' }}>
        <Tabs
          style={{ height: '100%' }}
          activeKey={activeTab}
          size="small"
          tabPosition="top"
          destroyInactiveTabPane
          onChange={(key) => {
            setActiveTab(key);
            setPage(1);
          }}
          items={STATUS_TABS.map((t) => {
            const cnt = t.status
              .split(',')
              .reduce((sum, s) => sum + (counts[Number(s)] || 0), 0);
            return {
              key: t.key,
              label: `${t.label} (${cnt})`,
              children: tableNode,
            };
          })}
        />
      </div>

      <Modal
        open={createOpen}
        title="创建任务"
        okText="创建"
        confirmLoading={creating}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          onValuesChange={(changed) => {
            if ('type' in changed) setTypeSel(changed.type);
          }}
        >
          <Form.Item
            name="title"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="如 FedEx Rate 更新 2026-07" />
          </Form.Item>
          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select placeholder="选择类型" options={TYPE_OPTIONS} />
          </Form.Item>
          {typeSel === CUSTOM_TYPE && (
            <Form.Item
              name="customType"
              label="自定义类型"
              rules={[{ required: true, message: '请输入自定义类型' }]}
            >
              <Input placeholder="任意类型标识，如 my_custom_type" />
            </Form.Item>
          )}
          <Form.Item name="source" label="来源">
            <Input placeholder="默认 manual" />
          </Form.Item>
          <Form.Item name="payload" label="payload (JSON)">
            <Input.TextArea rows={6} placeholder='{"key": "value"}' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!detail}
        title={detail?.title}
        footer={null}
        onCancel={() => setDetail(null)}
        width={640}
      >
        {detail && detailMode === 'detail' ? (
          <div>
            <p>来源：{detail.source}</p>
            <p>状态：{STATUS_LABEL[detail.status]}</p>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              columns={[
                { title: '类型', dataIndex: 'name', key: 'name', width: 220 },
                { title: '费率', dataIndex: 'rate', key: 'rate' },
                { title: '生效日期', dataIndex: 'eff', key: 'eff' },
                { title: 'MZL_PriceID', dataIndex: 'mzl', key: 'mzl' },
              ]}
              dataSource={fuelDetailRows(detail.payload, detail.MZL_PriceID)}
            />
          </div>
        ) : detail ? (
          <div>
            <p>类型：{detail.type}</p>
            <p>来源：{detail.source}</p>
            <p>状态：{STATUS_LABEL[detail.status]}</p>
            {[2, 3, 4].includes(detail.status) ? (
              <>
                <p>
                  {detail.status === 4
                    ? '拒绝人'
                    : detail.status === 2
                    ? '通过人'
                    : '处理人'}
                  ：{detail.operator || '-'}
                </p>
                <p>
                  {detail.status === 4
                    ? '拒绝时间'
                    : detail.status === 2
                    ? '通过时间'
                    : '处理时间'}
                  ：{fmtTime(detail.updatedAt)}
                </p>
                <p>处理结果：{detail.result || '-'}</p>
              </>
            ) : (
              <p>处理：尚未处理（待审批）</p>
            )}
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
        ) : null}
      </Modal>
    </PageContainer>
  );
};

export default FbdCenter;
