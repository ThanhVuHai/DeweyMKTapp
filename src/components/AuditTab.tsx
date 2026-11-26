'use client';

import React from 'react';
import {
  ClipboardList,
  ShieldAlert,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Layers,
  Activity,
  UserCheck,
  Terminal,
  Database,
} from 'lucide-react';

interface AuditTabProps {
  triggerRefresh: number;
}

interface UserInfo {
  name?: string;
  email?: string;
  role?: string;
}

interface LogItem {
  id: string;
  source: 'SYNC_LOG' | 'AUDIT_LOG';
  severity: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'CRITICAL';
  module: 'SYSTEM' | 'META_API' | 'META_CONNECTION' | 'SYNC_ENGINE' | 'DATABASE' | 'USER_ACTION';
  eventType: string;
  message: string;
  actor?: string | null;
  environment?: string | null;
  commitSha?: string | null;
  adAccountId?: string | null;
  reportingDateFrom?: string | null;
  reportingDateTo?: string | null;
  syncJobId?: string | null;
  correlationId?: string | null;
  stage?: string | null;
  durationMs?: number | null;
  recordCount?: number | null;
  retryAttempt?: number | null;
  httpStatus?: number | null;
  metaErrorCode?: number | null;
  metaErrorSubcode?: number | null;
  metaIsTransient?: boolean | null;
  metaFbtraceId?: string | null;
  metaErrorMessage?: string | null;
  sanitizedMeta?: Record<string, unknown> | string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  createdAt: string;
  user?: UserInfo | null;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AuditTab({ triggerRefresh }: AuditTabProps) {
  // Tabs: 'all' | 'sync' | 'user'
  const [activeTab, setActiveTab] = React.useState<'all' | 'sync' | 'user'>('all');

  // Logs & Pagination
  const [logs, setLogs] = React.useState<LogItem[]>([]);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pagination, setPagination] = React.useState<PaginationData>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [severityFilter, setSeverityFilter] = React.useState('');
  const [moduleFilter, setModuleFilter] = React.useState('');
  const [adAccountIdFilter, setAdAccountIdFilter] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [refreshTick, setRefreshTick] = React.useState(0);

  // Expand & Copy State
  const [expandedLogId, setExpandedLogId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  // Migration State
  const [migrationNeeded, setMigrationNeeded] = React.useState(false);
  const [migrationDisabled, setMigrationDisabled] = React.useState(false);
  const [migrating, setMigrating] = React.useState(false);
  const [migrationMessage, setMigrationMessage] = React.useState<{ text: string; success: boolean } | null>(null);

  const handleRunMigration = async () => {
    if (!window.confirm('Xác nhận áp dụng additive migration SyncLog trên Neon Preview? Thao tác này an toàn, tuân thủ DB isolation và không thay đổi dữ liệu hiện có.')) {
      return;
    }
    setMigrating(true);
    setMigrationMessage(null);
    try {
      const res = await fetch('/api/system/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMigrationNeeded(false);
        setMigrationDisabled(true);
        setMigrationMessage({
          text: data.alreadyApplied
            ? 'Bảng SyncLog đã sẵn sàng. Runtime migration execution đã được vô hiệu hóa để bảo đảm an toàn.'
            : `Migration thành công! Cấu trúc SyncLog đã sẵn sàng và toàn vẹn dữ liệu được bảo toàn (GIS Hà Nội: ${data.postMigration?.gisHanoiInsightsCount} insights, ${data.postMigration?.gisHanoiStoredSpend?.toLocaleString()} VND). Runtime migration đã được khóa.`,
          success: true,
        });
        setRefreshTick(t => t + 1);
      } else {
        setMigrationMessage({
          text: `Lỗi áp dụng migration: ${data.message || data.error || 'Thất bại'}`,
          success: false,
        });
      }
    } catch (err: unknown) {
      setMigrationMessage({
        text: `Lỗi kết nối khi gọi migration API: ${(err as Error).message}`,
        success: false,
      });
    } finally {
      setMigrating(false);
    }
  };

  React.useEffect(() => {
    let isCancelled = false;

    async function loadLogs() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('tab', activeTab);
        params.set('page', currentPage.toString());
        params.set('limit', '20');

        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        if (severityFilter) params.set('severity', severityFilter);
        if (moduleFilter) params.set('module', moduleFilter);
        if (adAccountIdFilter) params.set('adAccountId', adAccountIdFilter.trim());
        if (searchQuery.trim()) params.set('search', searchQuery.trim());

        const res = await fetch(`/api/audit-logs?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Lỗi nạp nhật ký (${res.status}): ${res.statusText}`);
        }

        const data = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }

        if (!isCancelled) {
          setLogs(data.logs || []);
          if (data.pagination) {
            setPagination(data.pagination);
          }
          if (data.migrationNeeded) {
            setMigrationNeeded(true);
          }
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Không thể tải nhật ký');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadLogs();

    return () => {
      isCancelled = true;
    };
  }, [activeTab, currentPage, dateFrom, dateTo, severityFilter, moduleFilter, adAccountIdFilter, searchQuery, refreshTick, triggerRefresh]);

  const handleCopy = (log: LogItem) => {
    try {
      const copyPayload = {
        id: log.id,
        timestamp: log.createdAt,
        severity: log.severity,
        module: log.module,
        eventType: log.eventType,
        message: log.message,
        stage: log.stage,
        durationMs: log.durationMs,
        recordCount: log.recordCount,
        adAccountId: log.adAccountId,
        syncJobId: log.syncJobId,
        correlationId: log.correlationId,
        metaError: log.metaErrorCode
          ? {
              code: log.metaErrorCode,
              subcode: log.metaErrorSubcode,
              isTransient: log.metaIsTransient,
              fbtraceId: log.metaFbtraceId,
              message: log.metaErrorMessage,
            }
          : undefined,
        metadata: log.sanitizedMeta
          ? typeof log.sanitizedMeta === 'string'
            ? JSON.parse(log.sanitizedMeta)
            : log.sanitizedMeta
          : undefined,
        before: log.beforeJson ? JSON.parse(log.beforeJson) : undefined,
        after: log.afterJson ? JSON.parse(log.afterJson) : undefined,
      };

      navigator.clipboard.writeText(JSON.stringify(copyPayload, null, 2));
      setCopiedId(log.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
      case 'ERROR':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      case 'WARN':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'DEBUG':
        return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
      case 'INFO':
      default:
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    }
  };

  const getModuleBadge = (module: string) => {
    switch (module) {
      case 'META_API':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'SYNC_ENGINE':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'DATABASE':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'USER_ACTION':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'META_CONNECTION':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'SYSTEM':
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800/60 pb-5">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-400" />
            Nhật ký hoạt động & Truy vết đồng bộ (Audit Trail & Observability)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Giám sát toàn diện luồng dữ liệu Meta Ads, đo lường thời gian thực thi, và chẩn đoán sự cố trực tiếp
          </p>
        </div>

        {/* Refresh & Count & Migration Button */}
        <div className="flex items-center gap-3">
          {!migrationDisabled && (
            <button
              onClick={handleRunMigration}
              disabled={migrating}
              className="flex items-center gap-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
              title="Áp dụng additive migration SyncLog trên Neon Preview"
            >
              <Database className={`w-3.5 h-3.5 ${migrating ? 'animate-spin' : ''}`} />
              {migrating ? 'Đang migration...' : 'Chạy Migration SyncLog'}
            </button>
          )}
          <span className="text-3xs font-mono text-slate-400 bg-slate-800/60 px-3 py-1.5 rounded-full border border-slate-700/50">
            {pagination.total} bản ghi ghi nhận
          </span>
          <button
            onClick={() => setRefreshTick(t => t + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-xl transition-all disabled:opacity-50"
            title="Làm mới danh sách"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* Migration Message or Warning Banner */}
      {migrationMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            migrationMessage.success
              ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
              : 'bg-rose-950/40 border-rose-700/50 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {migrationMessage.success ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{migrationMessage.text}</span>
          </div>
          <button
            onClick={() => setMigrationMessage(null)}
            className="text-3xs text-slate-400 hover:text-slate-200 ml-3"
          >
            Đóng
          </button>
        </div>
      )}

      {migrationNeeded && !migrationMessage && (
        <div className="p-3.5 rounded-xl border border-amber-600/40 bg-amber-950/30 text-amber-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Bảng <strong>SyncLog</strong> chưa được khởi tạo trên Neon PostgreSQL. Vui lòng bấm &ldquo;Chạy Migration SyncLog&rdquo; để kích hoạt tính năng lưu vết hoạt động đồng bộ.
            </span>
          </div>
          <button
            onClick={handleRunMigration}
            disabled={migrating}
            className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5"
          >
            <Database className="w-3.5 h-3.5" />
            {migrating ? 'Đang xử lý...' : 'Áp dụng Migration ngay'}
          </button>
        </div>
      )}

      {/* Segmented Control / Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-slate-950/40 rounded-2xl border border-slate-800/80">
        <button
          onClick={() => {
            setActiveTab('all');
            setCurrentPage(1);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'all'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Layers className="w-4 h-4" />
          Tất cả nhật ký (All Logs)
        </button>

        <button
          onClick={() => {
            setActiveTab('sync');
            setCurrentPage(1);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'sync'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Activity className="w-4 h-4" />
          Tiến trình đồng bộ (Sync Logs)
        </button>

        <button
          onClick={() => {
            setActiveTab('user');
            setCurrentPage(1);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'user'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          Thao tác người dùng (User Actions)
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-950/30 p-4 rounded-2xl border border-slate-800/60 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Filter className="w-4 h-4 text-indigo-400" />
          <span>Bộ lọc tìm kiếm nâng cao:</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          {/* Date From */}
          <div>
            <label className="text-3xs text-slate-400 block mb-1">Từ ngày:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="text-3xs text-slate-400 block mb-1">Đến ngày:</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Severity */}
          <div>
            <label className="text-3xs text-slate-400 block mb-1">Mức độ:</label>
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">Tất cả mức độ</option>
              <option value="INFO">INFO (Thông tin)</option>
              <option value="WARN">WARN (Cảnh báo)</option>
              <option value="ERROR">ERROR (Lỗi)</option>
              <option value="CRITICAL">CRITICAL (Nghiêm trọng)</option>
              <option value="DEBUG">DEBUG (Gỡ lỗi)</option>
            </select>
          </div>

          {/* Module */}
          <div>
            <label className="text-3xs text-slate-400 block mb-1">Phân hệ:</label>
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">Tất cả phân hệ</option>
              <option value="SYSTEM">SYSTEM</option>
              <option value="META_API">META_API</option>
              <option value="META_CONNECTION">META_CONNECTION</option>
              <option value="SYNC_ENGINE">SYNC_ENGINE</option>
              <option value="DATABASE">DATABASE</option>
              <option value="USER_ACTION">USER_ACTION</option>
            </select>
          </div>

          {/* Ad Account ID */}
          <div>
            <label className="text-3xs text-slate-400 block mb-1">Tài khoản QC:</label>
            <input
              type="text"
              placeholder="act_..."
              value={adAccountIdFilter}
              onChange={e => setAdAccountIdFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          {/* Search Query */}
          <div>
            <label className="text-3xs text-slate-400 block mb-1">Tìm kiếm từ khóa:</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Job ID / Mã lỗi..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/60 rounded-xl pl-7 pr-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
            </div>
          </div>
        </div>

        {/* Clear Filters Button */}
        {(dateFrom || dateTo || severityFilter || moduleFilter || adAccountIdFilter || searchQuery) && (
          <div className="pt-2 flex justify-end">
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setSeverityFilter('');
                setModuleFilter('');
                setAdAccountIdFilter('');
                setSearchQuery('');
              }}
              className="text-3xs text-indigo-400 hover:text-indigo-300 underline"
            >
              Đặt lại toàn bộ bộ lọc
            </button>
          </div>
        )}
      </div>

      {/* Main Table Content */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-xs space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p>Đang tải và đồng bộ nhật ký từ Neon PostgreSQL...</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-3 text-xs">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <span>Lỗi truy vấn nhật ký: {error}</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-800 rounded-2xl text-slate-400 text-xs space-y-2">
          <Terminal className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="font-semibold text-slate-300">Không tìm thấy bản ghi nhật ký phù hợp.</p>
          <p className="text-3xs text-slate-500">
            Hãy thử điều chỉnh bộ lọc hoặc chạy một tiến trình đồng bộ để tạo nhật ký mới.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead className="text-3xs text-slate-400 uppercase tracking-wider bg-slate-950/40 border-b border-slate-800/80">
                <tr>
                  <th className="py-3 px-4 font-semibold">Thời gian (VN)</th>
                  <th className="py-3 px-3 font-semibold">Mức độ</th>
                  <th className="py-3 px-3 font-semibold">Phân hệ</th>
                  <th className="py-3 px-4 font-semibold">Sự kiện</th>
                  <th className="py-3 px-4 font-semibold">Thông điệp chi tiết</th>
                  <th className="py-3 px-3 font-semibold">Tác nhân / Job ID</th>
                  <th className="py-3 px-3 text-center font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {logs.map((log: LogItem) => {
                  const isExpanded = expandedLogId === log.id;
                  const dateLocal = new Date(log.createdAt).toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  return (
                    <React.Fragment key={log.id}>
                      <tr className={`hover:bg-slate-800/20 transition-colors ${isExpanded ? 'bg-slate-800/30' : ''}`}>
                        {/* Time */}
                        <td className="py-3 px-4 font-mono text-3xs text-slate-400 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>{dateLocal}</span>
                          </div>
                        </td>

                        {/* Severity */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 text-3xs font-extrabold rounded-full border ${getSeverityBadge(log.severity)}`}>
                            {log.severity}
                          </span>
                        </td>

                        {/* Module */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 text-3xs font-semibold rounded-md border ${getModuleBadge(log.module)}`}>
                            {log.module}
                          </span>
                        </td>

                        {/* Event Type */}
                        <td className="py-3 px-4 font-mono text-3xs text-slate-300 font-semibold">
                          {log.eventType}
                        </td>

                        {/* Message & Stage */}
                        <td className="py-3 px-4 max-w-md">
                          <p className="text-xs text-slate-200 line-clamp-2">{log.message}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {log.stage && (
                              <span className="text-3xs font-mono text-indigo-400 bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-800/40">
                                {log.stage}
                              </span>
                            )}
                            {log.durationMs !== null && log.durationMs !== undefined && (
                              <span className="text-3xs font-mono text-cyan-400 bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-800/30">
                                {log.durationMs}ms
                              </span>
                            )}
                            {log.recordCount !== null && log.recordCount !== undefined && (
                              <span className="text-3xs font-mono text-amber-400 bg-amber-950/30 px-1.5 py-0.5 rounded border border-amber-800/30">
                                {log.recordCount} rows
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actor / Job */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="text-3xs font-mono text-slate-300 block truncate max-w-[130px]">
                            {log.actor || (log.user ? log.user.name || log.user.email : 'System')}
                          </span>
                          {log.syncJobId && (
                            <span className="text-3xs font-mono text-slate-500 block truncate max-w-[130px]" title={log.syncJobId}>
                              Job: {log.syncJobId.slice(0, 8)}
                            </span>
                          )}
                          {log.correlationId && (
                            <span className="text-3xs font-mono text-indigo-400/80 block truncate max-w-[130px]" title={log.correlationId}>
                              CID: {log.correlationId.slice(0, 8)}
                            </span>
                          )}
                        </td>

                        {/* Action buttons */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className={`p-1.5 rounded-lg border transition-all ${
                                isExpanded
                                  ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/40'
                                  : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-transparent'
                              }`}
                              title={isExpanded ? 'Thu gọn' : 'Xem chi tiết'}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleCopy(log)}
                              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-all"
                              title="Sao chép chi tiết đã khử mã độc"
                            >
                              {copiedId === log.id ? (
                                <Check className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Details Pane */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-slate-950/60 p-5 border-l-4 border-indigo-500 space-y-4">
                            {/* Meta Error Banner if present */}
                            {log.metaErrorCode && (
                              <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-3.5 space-y-1.5 text-xs">
                                <div className="flex items-center gap-2 text-rose-400 font-bold">
                                  <AlertTriangle className="w-4 h-4 shrink-0" />
                                  <span>
                                    Lỗi Meta Marketing API [Mã: {log.metaErrorCode}
                                    {log.metaErrorSubcode ? ` | Subcode: ${log.metaErrorSubcode}` : ''}]
                                  </span>
                                  {log.metaIsTransient && (
                                    <span className="bg-amber-500/20 text-amber-300 text-3xs px-2 py-0.5 rounded border border-amber-500/40">
                                      Tạm thời (Transient)
                                    </span>
                                  )}
                                </div>
                                <p className="text-rose-200 font-mono text-2xs">{log.metaErrorMessage}</p>
                                {log.metaFbtraceId && (
                                  <p className="text-slate-400 text-3xs font-mono">
                                    Meta Trace ID (fbtrace_id): <span className="text-slate-200">{log.metaFbtraceId}</span>
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Key Execution Context */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/50 p-3 rounded-xl border border-slate-800/60 text-2xs font-mono">
                              <div>
                                <span className="text-slate-500 block text-3xs">Tài khoản quảng cáo:</span>
                                <span className="text-slate-200 font-bold">{log.adAccountId || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-3xs">SyncJob ID:</span>
                                <span className="text-slate-200">{log.syncJobId || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-3xs">Correlation ID:</span>
                                <span className="text-indigo-300">{log.correlationId || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-3xs">Môi trường & Commit:</span>
                                <span className="text-slate-200">
                                  {log.environment || 'local'} {log.commitSha ? `(${log.commitSha.slice(0, 7)})` : ''}
                                </span>
                              </div>
                            </div>

                            {/* Before & After JSON (for User Actions) */}
                            {(log.beforeJson || log.afterJson) && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-2xs font-mono">
                                <div>
                                  <span className="text-rose-400 block mb-1 font-bold">Dữ liệu trước (Before):</span>
                                  <pre className="bg-slate-950 border border-slate-800 p-3 rounded-xl overflow-x-auto text-rose-300 max-h-48 text-3xs">
                                    {log.beforeJson ? JSON.stringify(JSON.parse(log.beforeJson), null, 2) : 'null'}
                                  </pre>
                                </div>
                                <div>
                                  <span className="text-emerald-400 block mb-1 font-bold">Dữ liệu sau (After):</span>
                                  <pre className="bg-slate-950 border border-slate-800 p-3 rounded-xl overflow-x-auto text-emerald-300 max-h-48 text-3xs">
                                    {log.afterJson ? JSON.stringify(JSON.parse(log.afterJson), null, 2) : 'null'}
                                  </pre>
                                </div>
                              </div>
                            )}

                            {/* Sanitized Metadata JSON */}
                            {log.sanitizedMeta != null && (
                              <div>
                                <span className="text-indigo-400 block mb-1 font-bold text-2xs font-mono">
                                  Metadata sự kiện (Sanitized Metadata):
                                </span>
                                <pre className="bg-slate-950 border border-slate-800 p-3 rounded-xl overflow-x-auto text-cyan-300 max-h-48 text-3xs font-mono">
                                  {JSON.stringify(
                                    typeof log.sanitizedMeta === 'string'
                                      ? JSON.parse(log.sanitizedMeta)
                                      : log.sanitizedMeta,
                                    null,
                                    2
                                  )}
                                </pre>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-400 pt-2">
            <div>
              Hiển thị <span className="font-semibold text-slate-200">{logs.length}</span> trên tổng số{' '}
              <span className="font-semibold text-slate-200">{pagination.total}</span> sự kiện
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={pagination.page <= 1 || loading}
                className="px-3 py-1.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 rounded-xl text-slate-300 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Trang trước
              </button>

              <span className="text-3xs font-mono text-slate-300 bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-800">
                Trang {pagination.page} / {pagination.totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={pagination.page >= pagination.totalPages || loading}
                className="px-3 py-1.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 rounded-xl text-slate-300 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Trang sau
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
