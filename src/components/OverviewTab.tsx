'use client';

import React from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Users, DollarSign, Target, Award, ShieldAlert, Sparkles, TrendingUp, AlertTriangle } from 'lucide-react';
import { formatVND, formatPercent, formatNumber, formatDate, formatVNDFull } from '@/lib/metrics';

interface OverviewSummary {
  spend: number;
  targetBudget: number;
  leads: number;
  targetLeads: number;
  cpl: number;
  qualifiedLeads: number;
  leadToQlRate: number;
  pacingGap: number;
  budgetUsedPct: number;
  timePassedPct: number;
}

interface CampaignSummaryItem {
  id: string;
  name: string;
  spend: number;
  leads: number;
  cpl: number;
}

interface AdSummaryItem {
  id: string;
  name: string;
  impressions: number;
  leads: number;
  ctr: number;
}

interface DailyTrendItem {
  date: string;
  spend: number;
  leads: number;
  cpl: number;
}

interface OverviewData {
  summary: OverviewSummary;
  dailyTrends: DailyTrendItem[];
  topCampaignsByLeads: CampaignSummaryItem[];
  worstCampaignsByCpl: CampaignSummaryItem[];
  topAdsByCtr: AdSummaryItem[];
  isEmpty?: boolean;
  error?: string;
}

interface OverviewTabProps {
  filters: {
    accountId: string;
    dateFrom: string;
    dateTo: string;
    campus: string;
    grade: string;
    source: string;
  };
  triggerRefresh: number;
}

export default function OverviewTab({ filters, triggerRefresh }: OverviewTabProps) {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams({
          accountId: filters.accountId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          campus: filters.campus,
          grade: filters.grade,
          source: filters.source,
        });

        const res = await fetch(`/api/dashboard/overview?${queryParams.toString()}`);
        const result = await res.json();

        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch overview data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, triggerRefresh]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-32 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50 lg:col-span-2" />
          <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-start space-x-4">
        <ShieldAlert className="w-6 h-6 text-red-400 shrink-0 mt-1" />
        <div>
          <h3 className="font-semibold text-lg">Đã xảy ra lỗi</h3>
          <p className="text-sm opacity-90 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20 backdrop-blur-md">
        <Activity className="w-16 h-16 text-indigo-400 opacity-60 mb-6 animate-bounce" />
        <h3 className="font-bold text-2xl text-slate-200">Không có dữ liệu quảng cáo</h3>
        <p className="text-slate-400 max-w-md mt-2">
          Hệ thống chưa tìm thấy dữ liệu. Hãy cấu hình kết nối API trong Meta API Settings hoặc kích hoạt **Seed Demo Data** trên thanh Topbar để trải nghiệm.
        </p>
      </div>
    );
  }

  const { summary, dailyTrends, topCampaignsByLeads, worstCampaignsByCpl, topAdsByCtr } = data;

  const cards = [
    {
      title: 'Tổng Chi Tiêu',
      value: formatVNDFull(summary.spend),
      sub: `${formatVND(summary.targetBudget)} Budget`,
      icon: DollarSign,
      color: 'from-pink-500 to-rose-500',
    },
    {
      title: 'Số Leads thu về',
      value: formatNumber(summary.leads),
      sub: `KPI: ${summary.targetLeads}`,
      icon: Users,
      color: 'from-emerald-500 to-teal-500',
    },
    {
      title: 'Chi phí mỗi Lead (CPL)',
      value: formatVNDFull(summary.cpl),
      sub: 'Mục tiêu: 250k',
      icon: Target,
      color: 'from-violet-500 to-indigo-500',
    },
    {
      title: 'Lead chất lượng (QL)',
      value: `${summary.qualifiedLeads} QL`,
      sub: `Tỷ lệ QL: ${formatPercent(summary.leadToQlRate)}`,
      icon: Award,
      color: 'from-amber-500 to-orange-500',
    }
  ];

  // Benchmark pacing logic
  const isSpendingTooFast = summary.pacingGap > 10;
  const isSpendingTooSlow = summary.pacingGap < -10;
  let pacingStatus = 'Đạt tiến độ';
  let pacingColor = 'bg-emerald-500';
  let pacingTextClass = 'text-emerald-400';

  if (isSpendingTooFast) {
    pacingStatus = 'Tiêu nhanh';
    pacingColor = 'bg-rose-500';
    pacingTextClass = 'text-rose-400';
  } else if (isSpendingTooSlow) {
    pacingStatus = 'Tiêu chậm';
    pacingColor = 'bg-amber-500';
    pacingTextClass = 'text-amber-400';
  }

  return (
    <div className="space-y-8">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="relative overflow-hidden group bg-slate-900/60 hover:bg-slate-900/80 transition-all border border-slate-800/80 p-6 rounded-2xl shadow-xl">
              <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${card.color} opacity-5 blur-2xl group-hover:opacity-15 transition-opacity rounded-full`} />
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{card.title}</span>
                  <div className="text-2xl lg:text-3xl font-extrabold text-slate-100">{card.value}</div>
                  <span className="text-slate-500 text-xs block font-medium">{card.sub}</span>
                </div>
                <div className={`p-3 bg-gradient-to-br ${card.color} rounded-xl shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pacing Alert Card */}
      <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-3xl shadow-xl backdrop-blur-sm grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 text-sm font-semibold">Tốc độ tiêu ngân sách</span>
            <span className={`px-2 py-0.5 text-2xs font-extrabold rounded-full ${pacingColor} text-slate-950 uppercase`}>{pacingStatus}</span>
          </div>
          <p className="text-xs text-slate-500">So sánh tiến trình chi tiêu ngân sách với thời gian trôi qua trong tháng.</p>
        </div>
        <div className="lg:col-span-2 space-y-3">
          <div className="flex justify-between text-xs font-bold text-slate-300">
            <span>Đã tiêu: {formatPercent(summary.budgetUsedPct)} ({formatVND(summary.spend)})</span>
            <span>Thời gian: {formatPercent(summary.timePassedPct)}</span>
          </div>
          <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden relative">
            <div className={`h-full ${pacingColor} rounded-full`} style={{ width: `${Math.min(100, summary.budgetUsedPct)}%` }} />
            <div className="absolute top-0 bottom-0 w-1 bg-white" style={{ left: `${summary.timePassedPct}%` }} title="Mốc thời gian trôi qua" />
          </div>
          <div className="flex items-center justify-between text-2xs text-slate-500">
            <span>KPI Target: {formatVND(summary.targetBudget)}</span>
            <span className={`font-semibold ${pacingTextClass}`}>
              {summary.pacingGap > 0 ? `Chi tiêu nhanh hơn tiến độ +${summary.pacingGap.toFixed(1)}%` : `Chi tiêu chậm hơn tiến độ ${summary.pacingGap.toFixed(1)}%`}
            </span>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-extrabold text-lg text-slate-200">Xu Hướng Chi Tiêu & Leads</h3>
              <p className="text-xs text-slate-500">Dữ liệu phân tích hiệu quả ngân sách quảng cáo theo ngày</p>
            </div>
            <div className="flex space-x-4 text-xs font-semibold">
              <span className="flex items-center text-indigo-400"><span className="w-3 h-3 bg-indigo-500 rounded-full mr-2" />Spend (VND)</span>
              <span className="flex items-center text-teal-400"><span className="w-3 h-3 bg-teal-500 rounded-full mr-2" />Leads</span>
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="date" tickFormatter={d => d.substring(8,10) + '/' + d.substring(5,7)} stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" stroke="#6366f1" tickFormatter={v => formatVND(v)} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" stroke="#14b8a6" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  labelFormatter={d => formatDate(d)}
                  formatter={(value: unknown, name: unknown) => [
                    name === 'spend' ? formatVNDFull(Number(value) || 0) : String(value ?? 0),
                    name === 'spend' ? 'Spend' : 'Leads'
                  ]}
                />
                <Area yAxisId="left" type="monotone" dataKey="spend" name="spend" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorSpend)" />
                <Area yAxisId="right" type="monotone" dataKey="leads" name="leads" stroke="#14b8a6" strokeWidth={2} fillOpacity={1} fill="url(#colorLeads)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
          <div className="mb-6">
            <h3 className="font-extrabold text-lg text-slate-200">Xu Hướng CPL</h3>
            <p className="text-xs text-slate-500">Biến động giá Lead trong khoảng thời gian</p>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="date" tickFormatter={d => d.substring(8,10)} stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#a78bfa" tickFormatter={v => formatVND(v)} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  labelFormatter={d => formatDate(d)}
                  formatter={(value: unknown) => [formatVNDFull(Number(value) || 0), 'CPL']}
                />
                <Line type="monotone" dataKey="cpl" stroke="#a78bfa" strokeWidth={3} activeDot={{ r: 8 }} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top lists Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Campaign by Leads */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
          <h3 className="font-extrabold text-md text-slate-200 mb-4 flex items-center">
            <TrendingUp className="w-5 h-5 text-teal-400 mr-2" /> Top Campaigns ra nhiều Lead
          </h3>
          <div className="divide-y divide-slate-800/80 max-h-96 overflow-y-auto space-y-3">
            {topCampaignsByLeads.map((c: CampaignSummaryItem) => (
              <div key={c.id} className="flex justify-between items-center py-2.5">
                <div className="max-w-[70%]">
                  <span className="font-bold text-xs text-slate-300 block truncate" title={c.name}>{c.name}</span>
                  <span className="text-3xs text-slate-500">Spend: {formatVND(c.spend)}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-extrabold text-teal-400 block">{c.leads} leads</span>
                  <span className="text-3xs text-slate-400">CPL: {formatVND(c.cpl)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Worst Campaigns by CPL */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
          <h3 className="font-extrabold text-md text-slate-200 mb-4 flex items-center">
            <AlertTriangle className="w-5 h-5 text-rose-400 mr-2" /> Campaigns CPL đắt đỏ
          </h3>
          <div className="divide-y divide-slate-800/80 max-h-96 overflow-y-auto space-y-3">
            {worstCampaignsByCpl.map((c: CampaignSummaryItem) => (
              <div key={c.id} className="flex justify-between items-center py-2.5">
                <div className="max-w-[70%]">
                  <span className="font-bold text-xs text-slate-300 block truncate" title={c.name}>{c.name}</span>
                  <span className="text-3xs text-slate-500">Leads: {c.leads} | Spend: {formatVND(c.spend)}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-extrabold text-rose-400 block">{formatVND(c.cpl)} CPL</span>
                  <span className="text-3xs text-slate-400">Đắt hơn benchmark</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Ads by CTR */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
          <h3 className="font-extrabold text-md text-slate-200 mb-4 flex items-center">
            <Sparkles className="w-5 h-5 text-indigo-400 mr-2" /> Mẫu Ads kéo CTR tốt nhất
          </h3>
          <div className="divide-y divide-slate-800/80 max-h-96 overflow-y-auto space-y-3">
            {topAdsByCtr.map((ad: AdSummaryItem) => (
              <div key={ad.id} className="flex justify-between items-center py-2.5">
                <div className="max-w-[70%]">
                  <span className="font-bold text-xs text-slate-300 block truncate" title={ad.name}>{ad.name}</span>
                  <span className="text-3xs text-slate-500">Impressions: {formatNumber(ad.impressions)}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-extrabold text-indigo-400 block">{formatPercent(ad.ctr)} CTR</span>
                  <span className="text-3xs text-slate-400">Leads: {ad.leads}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
