'use client';

import React from 'react';
import { Award, Zap, Compass, PlayCircle, Library, Sparkles, MessageSquare, CheckCircle, ShieldAlert } from 'lucide-react';
import { formatVND, formatPercent } from '@/lib/metrics';

interface ContentTabProps {
  filters: {
    dateFrom: string;
    dateTo: string;
  };
  triggerRefresh: number;
  onRefresh: () => void;
}

interface ContentPerformanceItem {
  name: string;
  spend: number;
  ctr: number;
  cpl: number;
  leads: number;
  ql: number;
  cpql: number;
  leadToQlRate: number;
  status: string;
}

interface WinFailItem {
  adId: string;
  contentId: string;
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
  leadToQlRate: number;
  rating: string;
  note?: string;
}

interface ContentPerformanceResponse {
  byContent: ContentPerformanceItem[];
  byFunnel: ContentPerformanceItem[];
  byAngle: ContentPerformanceItem[];
  byHookType: ContentPerformanceItem[];
  byFormat: ContentPerformanceItem[];
  winFailLibrary: WinFailItem[];
  textInsights: string[];
  error?: string;
}

type LocalTab = 'content' | 'funnel' | 'angle' | 'hook' | 'format' | 'library';

export default function ContentTab({ filters, triggerRefresh, onRefresh }: ContentTabProps) {
  const [activeTab, setActiveTab] = React.useState<LocalTab>('content');
  const [data, setData] = React.useState<ContentPerformanceResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        });

        const res = await fetch(`/api/dashboard/content-performance?${queryParams.toString()}`);
        const result = (await res.json()) as ContentPerformanceResponse;
        
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to fetch content performance';
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, triggerRefresh]);

  const handleUpdateStatus = async (adId: string, status: string) => {
    setUpdatingId(adId);
    try {
      const res = await fetch('/api/content-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId,
          contentStatus: status,
        }),
      });

      const result = await res.json();
      if (result.success) {
        // Trigger reload
        onRefresh();
        alert('Cập nhật trạng thái content thành công!');
      } else {
        alert(result.error || 'Failed to update status');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + message);
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="h-48 bg-slate-800/50 rounded-2xl border border-slate-700/50 lg:col-span-3" />
          <div className="h-48 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        </div>
        <div className="h-96 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-3">
        <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
        <span>Lỗi tải phân tích content: {error}</span>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { byContent, byFunnel, byAngle, byHookType, byFormat, winFailLibrary, textInsights } = data;

  const getCurrentList = () => {
    switch (activeTab) {
      case 'content': return byContent;
      case 'funnel': return byFunnel;
      case 'angle': return byAngle;
      case 'hook': return byHookType;
      case 'format': return byFormat;
      default: return [];
    }
  };

  const currentList = getCurrentList();

  const getStatusLabelColor = (status: string) => {
    switch (status) {
      case 'win': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'scale': return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
      case 'testing': return 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
      case 'fail': return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
      case 'archived': return 'bg-slate-800 text-slate-550 border border-slate-700';
      default: return 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8">
      {/* 1. Header & Text Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl lg:col-span-2 space-y-4">
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Sparkles className="w-5 h-5 text-indigo-400 mr-2" /> Báo cáo chất lượng & Đề xuất ý tưởng (Content Insights)
          </h3>
          <div className="space-y-3">
            {textInsights.map((insight: string, idx: number) => (
              <div key={idx} className="flex items-start space-x-3 text-xs text-slate-300 bg-slate-950/20 p-3.5 rounded-2xl border border-slate-850">
                <CheckCircle className="w-4.5 h-4.5 text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{insight}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-indigo-950/20 border border-indigo-500/20 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
          <div className="space-y-2">
            <h4 className="font-extrabold text-sm text-indigo-200 uppercase tracking-wider">Mẹo Content Marketing</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Phễu Marketing TOFU yêu cầu CTR cao (Hook hấp dẫn), MOFU yêu cầu Landing Page View & Lead rate ổn định, BOFU tập trung vào tối ưu hóa ưu đãi (Offer) & Form chuyển đổi.
            </p>
          </div>
          <div className="text-3xs text-indigo-400 font-bold mt-4">Ads Command Center Content Engine v1.0</div>
        </div>
      </div>

      {/* 2. Secondary Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800/60 pb-4">
        {[
          { key: 'content', label: 'By Content ID', icon: Award },
          { key: 'funnel', label: 'By Funnel Stage', icon: Zap },
          { key: 'angle', label: 'By Angle Theme', icon: Compass },
          { key: 'hook', label: 'By Hook Type', icon: MessageSquare },
          { key: 'format', label: 'By Media Format', icon: PlayCircle },
          { key: 'library', label: 'Win/Fail Library', icon: Library },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as LocalTab)}
              className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold rounded-xl border transition-all ${activeTab === tab.key ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg' : 'bg-slate-900/40 text-slate-400 border-slate-800 hover:text-slate-200'}`}
            >
              <Icon className="w-4.5 h-4.5" /> <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. Data Tables */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl shadow-xl overflow-hidden">
        {activeTab !== 'library' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="text-3xs text-slate-500 uppercase tracking-wider bg-slate-950/20 border-b border-slate-800/60">
                <tr>
                  <th className="py-4.5 px-6 font-semibold">Tên thuộc tính</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Chi tiêu</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CTR</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CPL</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Leads</th>
                  <th className="py-4.5 px-6 font-semibold text-right">QL</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CPQL</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Lead → QL rate</th>
                  <th className="py-4.5 px-6 font-semibold text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {currentList.map((item: ContentPerformanceItem, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-800/10">
                    <td className="py-4 px-6 font-bold text-slate-200">{item.name}</td>
                    <td className="py-4 px-6 text-right font-medium">{formatVND(item.spend)}</td>
                    <td className="py-4 px-6 text-right font-semibold text-indigo-400">{formatPercent(item.ctr)}</td>
                    <td className="py-4 px-6 text-right text-rose-400 font-extrabold">{formatVND(item.cpl)}</td>
                    <td className="py-4 px-6 text-right text-slate-100">{item.leads}</td>
                    <td className="py-4 px-6 text-right">{item.ql}</td>
                    <td className="py-4 px-6 text-right text-emerald-400">{formatVND(item.cpql)}</td>
                    <td className="py-4 px-6 text-right font-bold text-emerald-400">{formatPercent(item.leadToQlRate)}</td>
                    <td className="py-4 px-6 text-center">
                      <span className={`inline-block px-2.5 py-0.5 text-3xs font-extrabold rounded-full ${getStatusLabelColor(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* WIN/FAIL LIBRARY TAB */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="text-3xs text-slate-500 uppercase tracking-wider bg-slate-950/20 border-b border-slate-800/60">
                <tr>
                  <th className="py-4.5 px-6 font-semibold">Content ID</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Chi tiêu</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Leads</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CPL</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CTR</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Lead → QL rate</th>
                  <th className="py-4.5 px-6 font-semibold">Phân loại</th>
                  <th className="py-4.5 px-6 font-semibold">Ghi chú sáng tạo</th>
                  <th className="py-4.5 px-6 font-semibold text-center">Đánh nhãn nhanh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {winFailLibrary.map((item: WinFailItem, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-800/10">
                    <td className="py-4 px-6 font-black text-slate-200">{item.contentId}</td>
                    <td className="py-4 px-6 text-right font-medium">{formatVND(item.spend)}</td>
                    <td className="py-4 px-6 text-right">{item.leads}</td>
                    <td className="py-4 px-6 text-right text-indigo-400 font-extrabold">{formatVND(item.cpl)}</td>
                    <td className="py-4 px-6 text-right">{formatPercent(item.ctr)}</td>
                    <td className="py-4 px-6 text-right font-bold text-emerald-400">{formatPercent(item.leadToQlRate)}</td>
                    <td className="py-4 px-6">
                      <span className={`inline-block px-2 py-0.5 text-3xs font-extrabold rounded-full ${item.rating === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : item.rating === 'FAIL' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>
                        {item.rating}
                      </span>
                    </td>
                    <td className="py-4 px-6 max-w-xs truncate text-slate-400 italic" title={item.note}>{item.note || 'Không có ghi chú.'}</td>
                    <td className="py-4 px-6 text-center space-x-1.5">
                      <button
                        onClick={() => handleUpdateStatus(item.contentId, 'win')}
                        disabled={updatingId === item.contentId}
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-black text-3xs rounded-lg shadow-md transition-colors"
                      >
                        Win
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(item.contentId, 'scale')}
                        disabled={updatingId === item.contentId}
                        className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-3xs rounded-lg shadow-md transition-colors"
                      >
                        Scale
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(item.contentId, 'fail')}
                        disabled={updatingId === item.contentId}
                        className="px-2 py-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-3xs rounded-lg shadow-md transition-colors"
                      >
                        Fail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
