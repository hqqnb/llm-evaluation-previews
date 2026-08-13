// ---------- 界面层：面板、列表、提示、HUD、过渡 ----------
import { BIOMES, PARTS } from './config.js';

const $ = sel => document.querySelector(sel);

export function initUI(handlers) {
  const els = {
    loading: $('#loading'),
    fade: $('#fade'),
    tooltip: $('#tooltip'),
    toast: $('#toast'),
    lockHint: $('#lock-hint'),
    partsPanel: $('#parts-panel'),
    biomePanel: $('#biome-panel'),
    infoPanel: $('#info-panel'),
    helpPanel: $('#help-panel'),
    hudTop: $('#hud-top'),
    hudTitle: $('#hud-title'),
    hudSub: $('#hud-sub'),
    hudBottom: $('#hud-bottom'),
    hudHint: $('#hud-hint'),
    partsList: $('#parts-list'),
    ringAList: $('#ring-a-list'),
    ringBList: $('#ring-b-list'),
    infoContent: $('#info-content'),
  };

  // 部件列表
  els.partsList.innerHTML = '';
  for (const p of PARTS) {
    const item = document.createElement('div');
    item.className = 'part-item';
    item.dataset.part = p.id;
    const tag = p.kind === 'novel' ? '原著设定' : '合理演绎';
    item.innerHTML = `<span class="swatch" style="background:#4a9de8"></span>
      <span style="flex:1">${p.name}<br><span style="color:var(--muted);font-size:10.5px">${tag}</span></span>`;
    item.addEventListener('click', () => handlers.onPartClick(p.id, item));
    els.partsList.appendChild(item);
  }

  // 生态舱列表
  const mkBiomeItem = (b, key) => {
    const item = document.createElement('div');
    item.className = 'biome-item';
    item.dataset.biome = b.id;
    item.dataset.key = key;
    const sw = swatchFor(b);
    item.innerHTML = `<span class="swatch" style="background:${sw}"></span>
      <span class="biome-name">${b.name}<br><span style="color:var(--muted);font-size:10px">${b.en} · ${b.note}</span></span>
      <span class="go">进入 →</span>`;
    item.addEventListener('click', () => handlers.onBiomeClick(b.id));
    return item;
  };
  for (const b of BIOMES) {
    (b.ring === 'A' ? els.ringAList : els.ringBList).appendChild(mkBiomeItem(b, `${b.ring}-${b.id}`));
  }

  // 设定依据
  els.infoContent.innerHTML = infoHTML();

  // 顶栏按钮
  $('#btn-exterior').addEventListener('click', () => handlers.onMode('exterior'));
  $('#btn-interior').addEventListener('click', () => handlers.onMode('interior'));
  $('#btn-spine').addEventListener('click', () => handlers.onMode('spine'));
  $('#btn-back-ext').addEventListener('click', () => handlers.onMode('exterior'));
  $('#btn-info').addEventListener('click', () => els.infoPanel.classList.toggle('hidden'));
  $('#btn-help').addEventListener('click', () => els.helpPanel.classList.toggle('hidden'));

  // 控制条
  $('#toggle-decel').addEventListener('change', e => handlers.onDecel(e.target.checked));
  $('#spin-mode').addEventListener('change', e => handlers.onSpinMode(e.target.value));
  $('#speed-slider').addEventListener('input', e => handlers.onSpeed(Number(e.target.value)));

  // 锁提示
  els.lockHint.addEventListener('click', () => handlers.onLockRequest());

  let toastTimer = null;
  const api = {
    els,

    loadingDone() {
      els.loading.classList.add('done');
      setTimeout(() => els.loading.remove(), 900);
    },

    showToast(msg, dur = 2600) {
      els.toast.textContent = msg;
      els.toast.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('on'), dur);
    },

    fade(cb) {
      els.fade.classList.add('on');
      setTimeout(() => {
        cb && cb();
        setTimeout(() => els.fade.classList.remove('on'), 120);
      }, 340);
    },

    setMode(mode) {
      const interior = mode !== 'exterior';
      els.partsPanel.classList.toggle('hidden', interior);
      els.biomePanel.classList.toggle('hidden', !interior);
      els.hudTop.classList.toggle('hidden', !interior);
      els.hudBottom.classList.toggle('hidden', !interior);
      $('#btn-exterior').classList.toggle('primary', !interior);
      $('#btn-interior').classList.toggle('primary', interior);
      $('#btn-spine').classList.toggle('primary', mode === 'spine');
      $('#controls-bar').classList.toggle('hidden', interior);
    },

    setHUD(title, sub, hint) {
      els.hudTitle.textContent = title;
      els.hudSub.textContent = sub || '';
      if (hint) {
        els.hudBottom.classList.remove('hidden');
        els.hudHint.textContent = hint;
      } else {
        els.hudBottom.classList.add('hidden');
      }
    },

    showTooltip(html, x, y) {
      els.tooltip.innerHTML = html;
      els.tooltip.classList.remove('hidden');
      const w = els.tooltip.offsetWidth;
      const h = els.tooltip.offsetHeight;
      els.tooltip.style.left = `${Math.min(window.innerWidth - w - 14, x + 16)}px`;
      els.tooltip.style.top = `${Math.min(window.innerHeight - h - 14, y + 14)}px`;
    },

    hideTooltip() { els.tooltip.classList.add('hidden'); },

    setPartActive(partId) {
      els.partsList.querySelectorAll('.part-item').forEach(el => {
        el.classList.toggle('active', el.dataset.part === partId);
      });
    },

    setBiomeActive(id) {
      els.biomePanel.querySelectorAll('.biome-item').forEach(el => {
        el.classList.toggle('active', el.dataset.biome === id);
      });
    },

    showLockHint(on) { els.lockHint.classList.toggle('hidden', !on); },
  };
  return api;
}

function swatchFor(b) {
  const map = {
    coast: '#5d8a5e', farm: '#7fae5a', alpine: '#c6d4dc', taiga: '#6f8478',
    river: '#67a086', plateau: '#c2a869', steppe: '#b0b568', med: '#a3a06a',
    savanna: '#c2a75e', jungle: '#3d7440', tropical: '#42804a', alpine2: '#8ea08c',
    prairie: '#9fae62', boreal: '#74877b', pampa: '#b4b26c', desert: '#d2ad6c',
    forest: '#62804e', rainforest: '#46745c', patagonia: '#9ba096', generic: '#82946a',
  };
  return map[b.type] || '#82946a';
}

function infoHTML() {
  const novel = '<span class="tag novel">原著设定</span>';
  const infer = '<span class="tag infer">合理演绎</span>';
  return `
    <p>${novel}<b>小说与飞船</b>：金·斯坦利·罗宾逊《极光》（Aurora，2015；中译本 2020 重庆出版社）。世代飞船 2545 年从土星轨道出发，载约 2122 人航行 170 年，以约十分之一光速驶向天仓五（Tau Ceti）的宜居卫星“极光”。同型姊妹舰在航程早期失联。</p>
    <h4>船体结构（原著明确）</h4>
    <p>${novel}主轴（spine）长 <b>10 公里</b>，贯穿全舰；两个<b>对向旋转</b>的生态环如同套在车轴上的轮子。</p>
    <p>${novel}每环由 <b>12 个生态舱</b>相接而成，舱直径 <b>1 公里</b>、长 <b>4 公里</b>，十二舱以 30° 相接，舱间闸门“两端各斜置 15°”；环直径约 15.3 公里，旋转提供 <b>0.83g</b>。</p>
    <p>${novel}环 A 为“旧世界”生态（塔斯马尼亚、喜马拉雅、长江、西伯利亚、蒙古……），环 B 为“新世界”生态（新斯科舍、拉布拉多、哥斯达黎加、亚马逊……）。返回地球时取走的是<b>环 B 与主轴</b>。</p>
    <p>${novel}每个外环通过<b>六根辐条</b>连接主轴，并配“内结构环”锁紧；两环反向旋转以抵消角动量。</p>
    <h4>推进与减速（原著）</h4>
    <p>${novel}聚变推进，出航由<b>土星轨道激光阵列</b>助推；返航时激光透镜已停用，飞船以约 3% 光速进入太阳系，靠<b>引力弹弓与磁场制动</b>减速——书中描写减速时外壳“先是暗红，继而发亮”。</p>
    <h4>舱内生活（原著）</h4>
    <p>${novel}生态舱各有约三百居民；新斯科舍舱是总工程师<b>德维</b>一家的农庄。舰载量子 AI 被德维昵称为“<b>波琳</b>”（Pauline），全书主要由 AI 自述。菲娅的“游历”（Wanderjahr）即走遍 24 个生态舱。</p>
    <h4>本作还原说明</h4>
    <p>${novel}尺寸、双环对旋、12×4km 生态舱、30°/15° 闸门、六辐条、0.83g、主轴长度、舰桥位于主轴前端、AI 核心等均按原著/资料页建模。</p>
    <p>${infer}采光面朝向主轴（模拟昼夜光带）、发动机喷口造型、内结构环半径、舱内农庄/树木细节为视觉演绎；环 A/B 的前后位置原著未明示，此处为视觉安排。</p>
    <p class="src">资料来源：kimstanleyrobinson.info《Aurora》设定页、Strange Horizons 书评（2015）、NSS 评论、johnesimpson.com 评论、SuperSummary、维基百科等。</p>
  `;
}
