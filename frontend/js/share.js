// 只读分享页：按 URL 里的 token 读取攻略并渲染，不提供任何修改入口。

const token = window.location.pathname.split('/').filter(Boolean).pop();

function minutesText(minutes) {
  const value = Math.round(Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours} 小时 ${rest} 分钟` : `${rest} 分钟`;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

async function main() {
  const titleBox = document.getElementById('title');
  const metaBox = document.getElementById('meta');
  const content = document.getElementById('content');
  try {
    const response = await fetch(`/api/guides/shared/${encodeURIComponent(token)}`);
    if (!response.ok) throw new Error(response.status === 404 ? '分享链接已失效' : `载入失败：${response.status}`);
    const payload = await response.json();
    const guide = payload.guide;
    titleBox.textContent = guide.name || '我的攻略';
    const totals = guide.totals || {};
    metaBox.textContent = `共 ${(guide.items || []).length} 天 · 总里程 ${totals.distance_km || 0} 公里 · 总时长 ${minutesText(
      totals.minutes,
    )} · 只读`;
    if (!(guide.items || []).length) {
      content.innerHTML = '<div class="empty">这份攻略还没有任何一天。</div>';
      return;
    }
    content.innerHTML = guide.items
      .map((item) => {
        const flow = item.flow || {};
        const leg = item.leg
          ? `<small>城际：${escapeHtml(item.leg.from || '')} → ${escapeHtml(item.leg.to || '')} · ${Math.round(
              item.leg.minutes,
            )} 分钟 · ${item.leg.distance_km} km${item.leg.estimated ? '（估算）' : ''}</small>`
          : '';
        const timeline = (flow.timeline || [])
          .map((stop) => `<li>${escapeHtml(stop.arrive_text || '')} ${escapeHtml(stop.name || '')}</li>`)
          .join('');
        return `<section class="day">
          <h2>第 ${item.day} 天 · <span class="city">${escapeHtml(flow.city || '')}</span></h2>
          <div>${escapeHtml(flow.name || '')}｜${flow.points || 0} 个点位${
          flow.end_time ? `｜${escapeHtml(flow.end_time)} 结束` : ''
        }${flow.distance_km ? `｜${flow.distance_km} km` : ''}</div>
          ${timeline ? `<ul>${timeline}</ul>` : ''}
          ${item.notes ? `<small>备注：${escapeHtml(item.notes)}</small>` : ''}
          ${leg}
        </section>`;
      })
      .join('');
  } catch (error) {
    titleBox.textContent = '无法打开这份攻略';
    metaBox.textContent = error.message || '未知错误';
  }
}

main();
