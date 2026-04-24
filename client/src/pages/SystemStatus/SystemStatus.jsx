import { useTranslation } from 'react-i18next';
import { useSystemStatus } from '../../hooks/useSystemStatus';

// ── Формирователи индикаторов: из snapshot → {status, label, detail} ──
// status: 'ok' | 'warn' | 'fail' | 'unknown'
function servicesList(services) {
  if (!services) return [];
  return Object.entries(services).map(([name, state]) => {
    const status = state === 'active' ? 'ok' : (state === 'activating' ? 'warn' : 'fail');
    return { key: `service:${name}`, label: name, status, detail: state };
  });
}

function scannerIndicator(scanner) {
  if (!scanner) return { key: 'scanner', label: 'Scanner', status: 'unknown', detail: '—' };
  if (!scanner.found) return { key: 'scanner', label: 'Scanner', status: 'fail', detail: 'not found' };
  if (!scanner.grabbedByScaleClient) {
    return { key: 'scanner', label: 'Scanner', status: 'warn',
             detail: `found at ${scanner.devicePath}, no exclusive grab` };
  }
  return { key: 'scanner', label: 'Scanner', status: 'ok',
           detail: `${scanner.name} grabbed @ ${scanner.devicePath}` };
}

function scaleIndicator(scale) {
  if (!scale) return { key: 'scale-activity', label: 'Scale activity', status: 'unknown', detail: '—' };
  if (scale.error) return { key: 'scale-activity', label: 'Scale activity', status: 'warn', detail: scale.error };
  const sa = scale.secondsAgo;
  if (sa == null) return { key: 'scale-activity', label: 'Scale activity', status: 'warn', detail: 'no recent events' };
  const status = sa <= 120 ? 'ok' : (sa <= 600 ? 'warn' : 'fail');
  return { key: 'scale-activity', label: 'Scale activity',
           status, detail: `last event ${sa}s ago` };
}

function haIndicator(ha) {
  if (!ha) return { key: 'ha', label: 'Home Assistant', status: 'unknown', detail: '—' };
  const dockerOk = ha.dockerState === 'running';
  const httpOk = ['200','401','302','303'].includes(String(ha.httpCode || ''));
  const status = dockerOk && httpOk ? 'ok' : (dockerOk ? 'warn' : 'fail');
  return { key: 'ha', label: 'Home Assistant', status,
           detail: `docker=${ha.dockerState} http=${ha.httpCode}` };
}

function tailscaleIndicator(ts) {
  if (!ts || ts.error) return { key: 'tailscale', label: 'Tailscale', status: 'fail', detail: ts?.error || '—' };
  const t = ts.connectionType || 'unknown';
  // На Gigacube нам нужен именно relay — поэтому relay здесь ok (не warn)
  const status = t.startsWith('relay') || t === 'direct' ? 'ok' : 'warn';
  const detail = t === 'direct' ? 'direct (UDP)' :
                 t.startsWith('relay') ? `DERP ${ts.derpRegion || ''}` : t;
  return { key: 'tailscale', label: 'Tailscale', status, detail };
}

function iptablesIndicator(ipt) {
  if (!ipt) return { key: 'iptables', label: 'UDP-block (iptables)', status: 'unknown', detail: '—' };
  const status = ipt.udpBlockActive ? 'ok' : 'warn';
  const detail = ipt.udpBlockActive ? 'UDP 41641 blocked (forces DERP)' : 'block missing';
  return { key: 'iptables', label: 'UDP-block (iptables)', status, detail };
}

function piZeroIndicator(pz) {
  if (!pz) return { key: 'pi-zero', label: 'Pi Zero (sensors)', status: 'unknown', detail: '—' };
  if (!pz.online) return { key: 'pi-zero', label: 'Pi Zero (sensors)', status: 'fail',
                           detail: pz.note || 'no MQTT messages' };
  const sa = pz.secondsAgo;
  const status = sa == null ? 'warn' : (sa <= 90 ? 'ok' : (sa <= 300 ? 'warn' : 'fail'));
  return { key: 'pi-zero', label: 'Pi Zero (sensors)', status,
           detail: sa != null ? `last msg ${sa}s ago (${pz.zoneId})` : `online (${pz.zoneId})` };
}

function usbIndicator(usb) {
  if (!usb) return { key: 'usb', label: 'USB devices', status: 'unknown', detail: '—' };
  const ok = usb.sonoff === 'present' && usb.scale === 'present';
  const missing = [];
  if (usb.sonoff !== 'present') missing.push('Sonoff');
  if (usb.scale !== 'present') missing.push('scale');
  return { key: 'usb', label: 'USB devices',
           status: ok ? 'ok' : 'fail',
           detail: ok ? 'Sonoff + scale by-id present' : `missing: ${missing.join(', ')}` };
}

function systemIndicators(sys) {
  if (!sys) return [];
  const out = [];
  if (sys.diskPercent != null) {
    const s = sys.diskPercent >= 90 ? 'fail' : (sys.diskPercent >= 75 ? 'warn' : 'ok');
    out.push({ key: 'disk', label: 'Disk /', status: s, detail: `${sys.diskPercent}% used` });
  }
  if (sys.load1 != null) {
    const s = sys.load1 >= 4 ? 'warn' : 'ok';
    out.push({ key: 'load', label: 'CPU load (1m)', status: s, detail: sys.load1.toFixed(2) });
  }
  if (sys.memFreeMB != null) {
    const s = sys.memFreeMB < 200 ? 'warn' : 'ok';
    out.push({ key: 'mem', label: 'Memory free', status: s, detail: `${sys.memFreeMB} MB` });
  }
  if (sys.uptimeSec != null) {
    const days = Math.floor(sys.uptimeSec / 86400);
    const hrs  = Math.floor((sys.uptimeSec % 86400) / 3600);
    out.push({ key: 'uptime', label: 'Uptime', status: 'ok', detail: `${days}d ${hrs}h` });
  }
  return out;
}

function buildIndicators(checks) {
  if (!checks) return [];
  return [
    ...servicesList(checks.services),
    scannerIndicator(checks.scanner),
    scaleIndicator(checks.scale),
    haIndicator(checks.ha),
    tailscaleIndicator(checks.tailscale),
    iptablesIndicator(checks.iptables),
    piZeroIndicator(checks.piZero),
    usbIndicator(checks.usb),
    ...systemIndicators(checks.system),
  ];
}

const DOT = {
  ok:      'bg-green-400',
  warn:    'bg-yellow-400',
  fail:    'bg-red-400',
  unknown: 'bg-dark-600',
};

export default function SystemStatus() {
  const { t } = useTranslation();
  const { snapshot, secondsAgo, probeOnline, loading, refresh, error, busy } = useSystemStatus();

  const indicators = snapshot ? buildIndicators(snapshot.checks) : [];
  const hasFails = indicators.some(i => i.status === 'fail');
  const hasWarns = indicators.some(i => i.status === 'warn');
  const summary = hasFails ? t('systemStatus.summaryFail')
                : hasWarns ? t('systemStatus.summaryWarn')
                : t('systemStatus.summaryOk');
  const summaryColor = hasFails ? 'text-red-400' : hasWarns ? 'text-yellow-400' : 'text-green-400';

  const ageLabel = secondsAgo == null ? '—'
                 : secondsAgo < 60 ? `${secondsAgo}s ago`
                 : secondsAgo < 3600 ? `${Math.floor(secondsAgo/60)}m ago`
                 : `${Math.floor(secondsAgo/3600)}h ago`;
  const staleLevel = secondsAgo == null ? 'unknown'
                   : secondsAgo < 360 ? 'ok'        // < 6 min — свежий
                   : secondsAgo < 900 ? 'warn'      // 6-15 min
                   : 'fail';                        // > 15 min

  return (
    <div className="p-6 max-w-6xl mx-auto text-white">
      <h1 className="text-2xl font-bold mb-1">{t('systemStatus.title')}</h1>
      <p className="text-sm text-dark-400 mb-4">{t('systemStatus.description')}</p>

      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${probeOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-sm">
              {t('systemStatus.probe')}: <span className={probeOnline ? 'text-green-400' : 'text-red-400'}>
                {probeOnline ? t('systemStatus.probeOnline') : t('systemStatus.probeOffline')}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${DOT[staleLevel]}`} />
            <span className="text-sm text-dark-300">
              {t('systemStatus.lastSnapshot')}: {ageLabel}
            </span>
          </div>
          <div className={`text-sm font-semibold ${summaryColor}`}>{summary}</div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={refresh}
            disabled={busy || !probeOnline}
            className="px-4 py-2 bg-primary-700 hover:bg-primary-600 text-white rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? t('systemStatus.refreshing') : t('systemStatus.refreshNow')}
          </button>
        </div>
        {error === 'probe-offline' && (
          <div className="mt-3 text-xs text-red-400">{t('systemStatus.errorProbeOffline')}</div>
        )}
        {error === 'refresh-failed' && (
          <div className="mt-3 text-xs text-red-400">{t('systemStatus.errorRefresh')}</div>
        )}
      </div>

      {loading ? (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-6 text-center text-dark-400 text-sm">
          {t('systemStatus.loading')}
        </div>
      ) : !snapshot ? (
        <div className="bg-dark-800 border border-dark-700 rounded-lg p-6 text-center text-dark-400 text-sm">
          {t('systemStatus.noSnapshots')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {indicators.map((ind) => (
            <div
              key={ind.key}
              className="bg-dark-800 border border-dark-700 rounded-lg p-3 flex items-start gap-3"
            >
              <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${DOT[ind.status]}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{ind.label}</div>
                <div className="text-xs text-dark-400 truncate" title={ind.detail}>{ind.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {snapshot && (
        <div className="mt-6 text-xs text-dark-500">
          {t('systemStatus.host')}: <code className="text-dark-300">{snapshot.host}</code>
          {' · '}
          {t('systemStatus.probeTook')}: <code className="text-dark-300">{snapshot.durationMs} ms</code>
          {' · '}
          {t('systemStatus.takenAt')}: <code className="text-dark-300">{new Date(snapshot.timestamp).toLocaleString()}</code>
        </div>
      )}
    </div>
  );
}
