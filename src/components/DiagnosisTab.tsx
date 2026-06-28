'use client';

import React from 'react';
import { 
  Activity, Users, DollarSign, Target, Award, ShieldAlert, 
  AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp, RefreshCw 
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DiagnosisTabProps {
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

export default function DiagnosisTab({ filters, triggerRefresh }: DiagnosisTabProps) {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedSkipped, setExpandedSkipped] = React.useState(false);
  const [dataQualityCollapsed, setDataQualityCollapsed] = React.useState(false);

  React.useEffect(() => {
    async function fetchDiagnosisData() {
      // Mandate date filter parameters
      if (!filters.dateFrom || !filters.dateTo) {
        setLoading(false);
        setData(null);
        return;
      }

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

        const res = await fetch(`/api/dashboard/ql-diagnosis?${queryParams.toString()}`);
        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || 'Failed to fetch diagnosis data');
        }

        setData(result);
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred.');
      } finally {
        setLoading(false);
      }
    }

    fetchDiagnosisData();
  }, [filters, triggerRefresh]);

  // Formatter utilities
  function formatVNDValue(amount: number | null | undefined): string {
    if (amount === null || amount === undefined) return 'N/A';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })
      .format(amount)
      .replace('₫', 'đ')
      .trim();
  }

  function formatPercent(val: number | null | undefined): string {
    if (val === null || val === undefined) return 'N/A';
    return `${val.toFixed(1)}%`;
  }

  function formatNumber(val: number | null | undefined): string {
    if (val === null || val === undefined) return 'N/A';
    return val.toLocaleString('vi-VN');
  }

  // Date Check validation
  if (!filters.dateFrom || !filters.dateTo) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20 backdrop-blur-md">
        <CalendarIcon className="w-16 h-16 text-indigo-400 opacity-60 mb-6 animate-bounce" />
        <h3 className="font-bold text-xl text-slate-200">Khoảng thời gian chưa được chọn</h3>
        <p className="text-slate-400 max-w-md mt-2 text-sm">
          Vui lòng chọn khoảng thời gian **dateFrom** và **dateTo** trên thanh bộ lọc phía trên để chạy chẩn đoán Qualified Leads (QL).
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-32 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
          ))}
        </div>
        <div className="h-48 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
          <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-950/20 border border-rose-500/50 text-rose-200 p-6 rounded-2xl flex items-start space-x-4">
        <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-1" />
        <div>
          <h3 className="font-semibold text-lg">Lỗi Chẩn Đoán</h3>
          <p className="text-sm opacity-90 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, segmentBreakdown, contentAttribution, dailyTrends, diagnostics, diagnosticsMeta, dataQuality } = data;

  const cards = [
    {
      title: 'Chi Phí Quảng Cáo',
      value: formatVNDValue(summary.spend),
      sub: `${formatNumber(summary.impressions)} Lượt hiển thị`,
      icon: DollarSign,
      color: 'from-pink-500 to-rose-500',
    },
    {
      title: 'Tổng Leads',
      value: `${formatNumber(summary.leads)} Leads`,
      sub: `CPL: ${formatVNDValue(summary.cpl)}`,
      icon: Users,
      color: 'from-emerald-500 to-teal-500',
    },
    {
      title: 'Qualified Leads (QL)',
      value: `${formatNumber(summary.qualifiedLeads)} / ${formatNumber(summary.kpiTargetQL)} QL`,
      sub: summary.qlForecast !== null 
        ? `Dự báo cuối tháng: ${formatNumber(summary.qlForecast)} QL`
        : `Dự báo: N/A (${summary.forecastNote})`,
      icon: Target,
      color: 'from-violet-500 to-indigo-500',
    },
    {
      title: 'CPQL Trung Bình',
      value: formatVNDValue(summary.cpql),
      sub: `Tỷ lệ Lead sang QL: ${formatPercent(summary.leadToQlRate)}`,
      icon: Award,
      color: 'from-amber-500 to-orange-500',
    }
  ];

  return (
    <div className="space-y-8 text-slate-300">

      {/* 1. Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="relative overflow-hidden group bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl shadow-xl">
              <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${card.color} opacity-5 blur-2xl group-hover:opacity-15 transition-opacity rounded-full`} />
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{card.title}</span>
                  <div className="text-2xl font-extrabold text-slate-100">{card.value}</div>
                  <span className="text-slate-400 text-xs block font-medium">{card.sub}</span>
                </div>
                <div className={`p-3 bg-gradient-to-br ${card.color} rounded-xl shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. Data Quality Audit Banner */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
        <button 
          onClick={() => setDataQualityCollapsed(!dataQualityCollapsed)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-800/10 transition-all text-left"
        >
          <div className="flex items-center space-x-3">
            {dataQuality.warnings.length > 0 ? (
              <div className="flex items-center space-x-2 text-amber-400">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
                <span className="font-extrabold text-sm uppercase tracking-wider">Cảnh báo chất lượng dữ liệu ({dataQuality.warnings.length})</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-emerald-400">
                <CheckCircle className="w-5 h-5" />
                <span className="font-extrabold text-sm uppercase tracking-wider">Chất lượng dữ liệu OK</span>
              </div>
            )}
          </div>
          {dataQualityCollapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
        </button>

        {!dataQualityCollapsed && (
          <div className="p-6 border-t border-slate-800/80 bg-slate-950/20 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-900/80 border border-slate-850 p-4 rounded-xl">
                <span className="text-slate-400 block mb-1">CRM Leads không khớp adId:</span>
                <span className="text-lg font-bold text-slate-200">{dataQuality.unmatchedCrmLeads}</span>
              </div>
              <div className="bg-slate-900/80 border border-slate-850 p-4 rounded-xl">
                <span className="text-slate-400 block mb-1">Daily Insights không khớp adId:</span>
                <span className="text-lg font-bold text-slate-200">{dataQuality.unmatchedInsights}</span>
              </div>
              <div className="bg-slate-900/80 border border-slate-850 p-4 rounded-xl">
                <span className="text-slate-400 block mb-1">QL không có mapping:</span>
                <span className="text-lg font-bold text-slate-200">{dataQuality.unattributedQualifiedLeads}</span>
              </div>
            </div>

            {dataQuality.warnings.length > 0 && (
              <div className="bg-amber-950/20 border border-amber-500/30 text-amber-200 p-4 rounded-xl space-y-2">
                <span className="text-xs font-extrabold uppercase tracking-wide flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1 text-amber-400" /> Chi tiết cảnh báo:
                </span>
                <ul className="list-disc pl-5 text-xs space-y-1 opacity-90">
                  {dataQuality.warnings.map((warn: string, idx: number) => (
                    <li key={idx}>{warn}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Diagnostics Alerts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-lg text-slate-200 uppercase tracking-wider">Chẩn đoán Engine (QL Diagnostics)</h3>
            <p className="text-xs text-slate-400 mt-0.5">Các phân tích tự động từ động cơ chẩn đoán</p>
          </div>
          <span className="text-2xs font-extrabold uppercase bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-400">
            Trực thuộc Sprint 1A
          </span>
        </div>

        {diagnostics.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-850 p-8 rounded-2xl text-center space-y-3">
            <Activity className="w-10 h-10 text-indigo-400/60 mx-auto" />
            <h4 className="font-bold text-sm text-slate-200">Không có cảnh báo chẩn đoán quan trọng nào được phát hiện trong khoảng thời gian này.</h4>
            <div className="flex items-center justify-center space-x-6 text-3xs text-slate-400 uppercase font-semibold">
              <span>Đã chạy: {diagnosticsMeta.rulesEvaluated} quy tắc</span>
              <span>Kích hoạt: {diagnosticsMeta.alertsTriggered} cảnh báo</span>
              <span>Bỏ qua: {diagnosticsMeta.skippedRules.length} quy tắc</span>
            </div>

            {/* Expand skipped reasons */}
            <div className="pt-2">
              <button 
                onClick={() => setExpandedSkipped(!expandedSkipped)}
                className="text-indigo-400 hover:text-indigo-300 font-extrabold text-xs transition-colors flex items-center mx-auto space-x-1"
              >
                <span>{expandedSkipped ? 'Ẩn chi tiết quy tắc đã bỏ qua' : 'Hiển thị chi tiết quy tắc đã bỏ qua'}</span>
                {expandedSkipped ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {expandedSkipped && (
              <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl text-left max-w-xl mx-auto space-y-2.5">
                <span className="text-3xs font-extrabold text-indigo-300 uppercase tracking-wider block">Nhật ký quy tắc đã quét:</span>
                <div className="space-y-1.5 text-xs">
                  {diagnosticsMeta.skippedRules.map((skip: any, idx: number) => (
                    <div key={idx} className="flex items-start space-x-2 bg-slate-900/50 p-2.5 rounded border border-slate-850/30">
                      <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-slate-300 text-xs block">{skip.type}</span>
                        <span className="text-slate-400 text-3xs block mt-0.5">{skip.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {diagnostics.map((alert: any, idx: number) => {
              const isHigh = alert.severity === 'high';
              const confColors = 
                alert.confidence === 'high' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                alert.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                'bg-slate-800/40 text-slate-300 border-slate-700/50';

              return (
                <div 
                  key={idx} 
                  className={`bg-slate-900/60 border rounded-2xl p-6 shadow-xl space-y-4 flex flex-col justify-between ${isHigh ? 'border-rose-500/30' : 'border-amber-500/30'}`}
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start gap-4">
                      <h4 className="font-extrabold text-sm text-slate-200">{alert.title}</h4>
                      <span className={`text-3xs font-bold uppercase border px-2 py-0.5 rounded-full shrink-0 ${confColors}`}>
                        Tin cậy: {alert.confidence}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{alert.message}</p>
                    
                    <div className="text-2xs bg-slate-950/20 border border-slate-850 p-3 rounded-xl">
                      <span className="font-bold text-slate-300 block mb-1">Nguyên nhân cốt lõi (Root Cause):</span>
                      <span className="text-slate-400">{alert.rootCause}</span>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2">
                    <span className="text-3xs font-extrabold text-indigo-400 uppercase tracking-wider block">Hành động đề xuất:</span>
                    <ul className="list-disc pl-5 text-xs space-y-1.5 text-slate-300">
                      {alert.recommendedActions.map((act: string, aIdx: number) => (
                        <li key={aIdx}>{act}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Spend, Leads, and QL daily trend chart */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-extrabold text-lg text-slate-200 uppercase tracking-wider">Biểu đồ xu hướng</h3>
            <p className="text-xs text-slate-400 mt-0.5">Biến động Spend và QLs theo ngày</p>
          </div>
          <div className="flex space-x-4 text-xs font-semibold">
            <span className="flex items-center text-indigo-400"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-full mr-2" />Spend</span>
            <span className="flex items-center text-teal-400"><span className="w-2.5 h-2.5 bg-teal-500 rounded-full mr-2" />QLs</span>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="qlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
              <XAxis dataKey="date" tickFormatter={d => d.substring(8,10) + '/' + d.substring(5,7)} stroke="#64748b" tick={{ fontSize: 9 }} />
              <YAxis yAxisId="left" stroke="#6366f1" tickFormatter={v => formatNumber(v)} tick={{ fontSize: 9 }} />
              <YAxis yAxisId="right" orientation="right" stroke="#14b8a6" tick={{ fontSize: 9 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0b1325', borderColor: '#334155', borderRadius: '12px' }}
                labelFormatter={d => d}
                formatter={(value: any, name: any) => [
                  name === 'spend' ? formatVNDValue(value) : value, 
                  name === 'spend' ? 'Spend' : 'QLs'
                ]}
              />
              <Area yAxisId="left" type="monotone" dataKey="spend" name="spend" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#spendGrad)" />
              <Area yAxisId="right" type="monotone" dataKey="qualifiedLeads" name="qualifiedLeads" stroke="#14b8a6" strokeWidth={2} fillOpacity={1} fill="url(#qlGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 5. Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Segment Breakdown */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <div>
              <h3 className="font-extrabold text-md text-slate-200 uppercase tracking-wider">Phân tích Segment (Breakdown)</h3>
              <p className="text-xs text-slate-400 mt-0.5">Hiệu suất chi tiết của từng Campus, Grade, và Source</p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 text-slate-400 font-semibold">
                    <th className="py-2.5">Segment</th>
                    <th className="py-2.5 text-right">Spend</th>
                    <th className="py-2.5 text-right">Leads</th>
                    <th className="py-2.5 text-right">QLs</th>
                    <th className="py-2.5 text-right">Rate</th>
                    <th className="py-2.5 text-right">CPQL</th>
                    <th className="py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {segmentBreakdown.map((seg: any, index: number) => {
                    let statusColor = 'bg-emerald-500';
                    let statusText = 'On Track';
                    if (seg.status === 'critical') {
                      statusColor = 'bg-rose-500';
                      statusText = 'Critical';
                    } else if (seg.status === 'at_risk') {
                      statusColor = 'bg-amber-500';
                      statusText = 'At Risk';
                    }

                    return (
                      <tr key={index} className="hover:bg-slate-850/20 transition-all text-slate-300">
                        <td className="py-3 font-medium">
                          <span className="block text-slate-200">{seg.campus} - {seg.grade}</span>
                          <span className="text-3xs text-slate-400 block">{seg.source}</span>
                        </td>
                        <td className="py-3 text-right">{formatVNDValue(seg.spend)}</td>
                        <td className="py-3 text-right">{formatNumber(seg.leads)}</td>
                        <td className="py-3 text-right font-extrabold text-slate-100">{seg.qualifiedLeads}</td>
                        <td className="py-3 text-right">{formatPercent(seg.leadToQlRate)}</td>
                        <td className="py-3 text-right text-indigo-300">{formatVNDValue(seg.cpql)}</td>
                        <td className="py-3 text-center">
                          <span className="inline-flex items-center space-x-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                            <span className="text-3xs uppercase font-extrabold">{statusText}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Content Attribution */}
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <div>
              <h3 className="font-extrabold text-md text-slate-200 uppercase tracking-wider">Phân tích Content Attribution</h3>
              <p className="text-xs text-slate-400 mt-0.5">Phân tích hiệu quả chuyển đổi dựa trên ContentMapping</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 text-slate-400 font-semibold">
                    <th className="py-2.5">Angle / Hook</th>
                    <th className="py-2.5 text-right">Spend</th>
                    <th className="py-2.5 text-right">Leads</th>
                    <th className="py-2.5 text-right">QLs</th>
                    <th className="py-2.5 text-right">Rate</th>
                    <th className="py-2.5 text-right">CPL</th>
                    <th className="py-2.5 text-right">CPQL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {contentAttribution.map((c: any, index: number) => (
                    <tr key={index} className="hover:bg-slate-850/20 transition-all text-slate-300">
                      <td className="py-3 font-medium">
                        <span className="block text-slate-200 truncate max-w-[120px]" title={c.angle}>{c.angle}</span>
                        <span className="text-3xs text-slate-400 block">{c.hookType} | {c.format}</span>
                      </td>
                      <td className="py-3 text-right">{formatVNDValue(c.spend)}</td>
                      <td className="py-3 text-right">{formatNumber(c.leads)}</td>
                      <td className="py-3 text-right font-extrabold text-slate-100">{c.qualifiedLeads}</td>
                      <td className="py-3 text-right">{formatPercent(c.leadToQlRate)}</td>
                      <td className="py-3 text-right text-slate-400">{formatVNDValue(c.cpl)}</td>
                      <td className="py-3 text-right text-indigo-300 font-semibold">{formatVNDValue(c.cpql)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}

// Simple Calendar helper icon component
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
