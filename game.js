// Lemon Tang - Telegram Mini App Game Engine

(() => {
  // --- Telegram WebApp инициализация ---
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();

    // Запрещаем случайное закрытие свайпом вниз в Telegram (Bot API 7.7+)
    try {
      if (typeof tg.disableVerticalSwipes === 'function') {
        tg.disableVerticalSwipes();
      }
      tg.isVerticalSwipesEnabled = false;
    } catch (e) {}

    // Подтверждение при попытке закрыть мини-апп во время игры
    try {
      if (typeof tg.enableClosingConfirmation === 'function') {
        tg.enableClosingConfirmation();
      }
    } catch (e) {}

    try {
      tg.setHeaderColor('#0f141c');
      tg.setBackgroundColor('#0f141c');
    } catch (e) {}
  }

  function triggerHaptic(type = 'light') {
    if (!tg?.HapticFeedback) return;
    try {
      if (type === 'error') {
        tg.HapticFeedback.notificationOccurred('error');
      } else if (type === 'heavy') {
        tg.HapticFeedback.impactOccurred('heavy');
      } else if (type === 'medium') {
        tg.HapticFeedback.impactOccurred('medium');
      } else {
        tg.HapticFeedback.impactOccurred('light');
      }
    } catch (e) {}
  }

  // --- Элементы DOM ---
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('game-container');

  const hud = document.getElementById('top-bar');
  const scoreEl = document.getElementById('score');
  const soundBtn = document.getElementById('sound-btn');
  const startScreen = document.getElementById('start-screen');
  const gameOverScreen = document.getElementById('game-over-screen');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');

  const finalScoreEl = document.getElementById('final-score');
  const finalBestEl = document.getElementById('final-best');
  const finalLemonsEl = document.getElementById('final-lemons');
  const finalComboEl = document.getElementById('final-combo');
  const finalRevivesEl = document.getElementById('final-revives');
  const menuBestScoreEl = document.getElementById('menu-best-score');
  const soundIconOn = document.getElementById('sound-icon-on');
  const soundIconOff = document.getElementById('sound-icon-off');

  const reviveScreen = document.getElementById('revive-screen');
  const reviveBtn = document.getElementById('revive-btn');
  const reviveProgressFill = document.getElementById('revive-progress-fill');
  const reviveCountdown = document.getElementById('revive-countdown');
  const verifyBtn = document.getElementById('verify-btn');
  const shareBtn = document.getElementById('share-btn');
  const verifyStatusEl = document.getElementById('verify-status');
  const primaryMetricCard = document.querySelector('.metric-card.primary-metric');
  const prizesScreen = document.getElementById('prizes-screen');
  const prizesChannelBtn = document.getElementById('prizes-channel-btn');
  const prizesBackBtn = document.getElementById('prizes-back-btn');
  const openPrizesBtns = document.querySelectorAll('.open-prizes-btn');

  const lifeIcons = [
    document.getElementById('life-1'),
    document.getElementById('life-2'),
    document.getElementById('life-3')
  ];

  // --- Нижний Dock ---
  const dockItems = document.querySelectorAll('.dock-item');
  dockItems.forEach(item => {
    item.addEventListener('click', () => {
      dockItems.forEach(d => d.classList.remove('active'));
      item.classList.add('active');
      triggerHaptic('light');
    });
  });

  // --- Состояние игры ---
  let width = 0;
  let height = 0;
  let dpr = 1;

  let gameState = 'START'; // 'START' | 'PLAYING' | 'REVIVE' | 'GAMEOVER'
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('lemon_ninja_best') || '0', 10);
  let previousBestScore = bestScore;
  let lives = 3;
  let slicedLemonsCount = 0;
  let goldenSlicedCount = 0; // Для античит-проверки
  let maxComboCount = 0;
  let hasRevived = false;
  let reviveCount = 0;
  let reviveTimerId = null;
  let lottiePlayer = null;
  // Теневой счётчик очков — независимо накапливается по каждому срезу
  let _shadowScore = 0;
  let _shadowComboBonus = 0;

  // Игровые объекты
  let activeItems = [];
  let halfLemons = [];
  let particles = [];
  let floatingTexts = [];
  let backgroundSplats = [];

  // Трейл свайпа
  let touchTrail = [];
  let isPointerDown = false;
  let lastCutTime = 0;
  let currentSwipeCombo = 0;

  // Спавнер
  let spawnTimer = 0;
  let nextSpawnInterval = 1.2; // в секундах
  let gravity = 980; // пикселей/сек^2

  // Screen shake
  let screenShake = 0;

  // --- Инициализация размеров ---
  function resize() {
    const rect = container.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', resize);
  resize();
  if (menuBestScoreEl) menuBestScoreEl.textContent = bestScore;

  // --- Вспомогательные функции ---
  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Расстояние от точки C до отрезка AB
  function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  // --- Класс Лимона / Бомбы ---
  class Item {
    constructor(type = 'LEMON') {
      this.type = type; // 'LEMON' | 'CROSS_SECTION' | 'GOLDEN' | 'BOMB'
      this.radius = type === 'BOMB' ? 36 : (type === 'GOLDEN' ? 34 : 38);
      
      // Спавн снизу экрана
      this.x = randomRange(width * 0.15, width * 0.85);
      this.y = height + this.radius + 10;

      // Рассчитываем скорость, чтобы долетал до верхней трети экрана
      const targetY = randomRange(height * 0.18, height * 0.38);
      const apexDist = this.y - targetY;
      const initialVy = -Math.sqrt(2 * gravity * apexDist);

      this.vy = initialVy;
      // Легкое смещение к центру экрана
      const centerX = width / 2;
      const dirX = (centerX - this.x) / (width * 0.5);
      this.vx = dirX * randomRange(40, 120);

      this.rotation = randomRange(0, Math.PI * 2);
      this.rotSpeed = randomRange(-3, 3);
      this.sliced = false;

      // Для анимации фитиля бомбы
      this.fuseTime = 0;
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += gravity * dt;
      this.rotation += this.rotSpeed * dt;

      if (this.type === 'BOMB') {
        this.fuseTime += dt;
        // Спавним искры от фитиля
        if (Math.random() < 0.6) {
          const fuseX = this.x + Math.cos(this.rotation - Math.PI / 2) * (this.radius + 14);
          const fuseY = this.y + Math.sin(this.rotation - Math.PI / 2) * (this.radius + 14);
          particles.push(new SparkParticle(fuseX, fuseY));
        }
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);

      if (this.type === 'LEMON') {
        this.drawWholeLemon(ctx);
      } else if (this.type === 'CROSS_SECTION') {
        this.drawCrossSectionLemon(ctx);
      } else if (this.type === 'GOLDEN') {
        this.drawGoldenLemon(ctx);
      } else if (this.type === 'BOMB') {
        this.drawBomb(ctx);
      }

      ctx.restore();
    }

    drawWholeLemon(ctx) {
      const r = this.radius;
      // Тень лимона
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.15, r * 0.88, 0, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r * 1.2);
      grad.addColorStop(0, '#fff466');
      grad.addColorStop(0.65, '#ffd200');
      grad.addColorStop(1, '#e09800');
      ctx.fillStyle = grad;
      ctx.fill();

      // Кончики лимона
      ctx.fillStyle = '#ffd200';
      ctx.beginPath();
      ctx.arc(r * 1.1, 0, r * 0.18, 0, Math.PI * 2);
      ctx.arc(-r * 1.1, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fill();

      // Текстурные поры (точечки)
      ctx.fillStyle = 'rgba(215, 140, 0, 0.25)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc((i * 12) - 24, (i % 2 === 0 ? 8 : -8), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Зелёный листик на черенке
      ctx.fillStyle = '#40916c';
      ctx.beginPath();
      ctx.ellipse(-r * 0.95, -r * 0.35, 12, 6, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCrossSectionLemon(ctx) {
      const r = this.radius;
      // 1. Внешняя желтая кожура
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd000';
      ctx.fill();

      // 2. Белая прослойка (альбедо)
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
      ctx.fillStyle = '#fffae0';
      ctx.fill();

      // 3. Мякоть долек
      const segmentCount = 8;
      const angleStep = (Math.PI * 2) / segmentCount;
      const innerRadius = r * 0.85;

      for (let i = 0; i < segmentCount; i++) {
        const startA = i * angleStep + 0.08;
        const endA = (i + 1) * angleStep - 0.08;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, innerRadius, startA, endA);
        ctx.closePath();

        const segGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, innerRadius);
        segGrad.addColorStop(0, '#fff566');
        segGrad.addColorStop(0.8, '#ffc700');
        segGrad.addColorStop(1, '#e59a00');

        ctx.fillStyle = segGrad;
        ctx.fill();

        // Маленькие капельки/везикулы внутри дольки
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        const midA = (startA + endA) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(midA) * 10, Math.sin(midA) * 10);
        ctx.lineTo(Math.cos(midA) * (innerRadius * 0.7), Math.sin(midA) * (innerRadius * 0.7));
        ctx.stroke();
      }

      // Центр (белая серединка)
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = '#fffce8';
      ctx.fill();
    }

    drawGoldenLemon(ctx) {
      const r = this.radius;
      // Золотое сияние
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.3);
      glow.addColorStop(0, 'rgba(255, 215, 0, 0.4)');
      glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fill();

      // Сам лимон с золотистым градиентом
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.15, r * 0.88, 0, 0, Math.PI * 2);
      const grad = ctx.createLinearGradient(-r, -r, r, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ffe066');
      grad.addColorStop(0.7, '#ffb703');
      grad.addColorStop(1, '#d48b00');
      ctx.fillStyle = grad;
      ctx.fill();

      // Звездочки блеска
      ctx.fillStyle = '#ffffff';
      const sparkSize = 4;
      ctx.fillRect(-r * 0.3, -r * 0.3, sparkSize, sparkSize);
      ctx.fillRect(r * 0.4, r * 0.2, sparkSize * 0.8, sparkSize * 0.8);
    }

    drawBomb(ctx) {
      const r = this.radius;

      // Тень / тело бомбы (темно-серый сферический градиент)
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
      grad.addColorStop(0, '#4a5568');
      grad.addColorStop(0.5, '#1a202c');
      grad.addColorStop(1, '#0b0e14');
      ctx.fillStyle = grad;
      ctx.fill();

      // Металлическое кольцо сверху
      ctx.fillStyle = '#718096';
      ctx.fillRect(-r * 0.25, -r - 5, r * 0.5, 6);

      // Фитиль
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -r - 5);
      ctx.quadraticCurveTo(8, -r - 14, 4, -r - 20);
      ctx.stroke();

      // Огонек на фитиле
      ctx.beginPath();
      ctx.arc(4, -r - 20, 5 + Math.sin(this.fuseTime * 25) * 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4d4d';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(4, -r - 20, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fffa65';
      ctx.fill();

      // Символ опасности на бомбе (череп или крест)
      ctx.fillStyle = 'rgba(255, 60, 60, 0.85)';
      ctx.font = 'bold 22px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💣', 0, 2);
    }
  }

  // --- Разрезанные половинки лимона ---
  class HalfLemon {
    constructor(x, y, radius, angle, side, isGolden = false) {
      this.x = x;
      this.y = y;
      this.radius = radius;
      this.angle = angle; // угол среза
      this.side = side;   // -1 (левая) или +1 (правая)
      this.isGolden = isGolden;

      // Скорость разлёта перпендикулярно лезвию среза
      const normalAngle = angle + (Math.PI / 2) * side;
      const speed = randomRange(160, 320);
      this.vx = Math.cos(normalAngle) * speed + randomRange(-40, 40);
      this.vy = Math.sin(normalAngle) * speed - randomRange(100, 200);

      this.rotation = angle;
      this.rotSpeed = side * randomRange(4, 9);
      this.alpha = 1;
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += gravity * dt;
      this.rotation += this.rotSpeed * dt;
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);

      const r = this.radius;

      // Рисуем полукруг со стороны разреза
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, this.side < 0);
      ctx.closePath();

      // Кожура
      ctx.fillStyle = this.isGolden ? '#ffb703' : '#ffd000';
      ctx.fill();

      // Сочная мякоть на срезе
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.88, -Math.PI / 2, Math.PI / 2, this.side < 0);
      ctx.closePath();
      ctx.fillStyle = this.isGolden ? '#ffe066' : '#fff466';
      ctx.fill();

      // Линия среза
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();

      ctx.restore();
    }
  }

  // --- Частицы сока (вытянутые капли по вектору полета) ---
  class JuiceDrop {
    constructor(x, y, isGolden = false) {
      this.x = x;
      this.y = y;
      this.radius = randomRange(2.2, 5.2);
      const angle = randomRange(0, Math.PI * 2);
      const speed = randomRange(140, 480);
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.alpha = 1;
      this.decay = randomRange(1.1, 2.1);
      this.color = isGolden ? '#ffea00' : (Math.random() < 0.25 ? '#ffffff' : '#ffd000');
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += gravity * 0.65 * dt;
      this.alpha -= this.decay * dt;
    }

    draw(ctx) {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.alpha);
      ctx.fillStyle = this.color;

      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 60) {
        // Капля вытягивается по направлению полета
        const moveAngle = Math.atan2(this.vy, this.vx);
        const stretch = Math.min(speed / 75, 2.8);
        ctx.translate(this.x, this.y);
        ctx.rotate(moveAngle);
        ctx.beginPath();
        ctx.ellipse(0, 0, this.radius * stretch, this.radius, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // --- Искры бомбы ---
  class SparkParticle {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.radius = randomRange(1.5, 3.5);
      this.vx = randomRange(-70, 70);
      this.vy = randomRange(-100, 20);
      this.alpha = 1;
      this.decay = randomRange(2.5, 4.5);
      this.color = Math.random() < 0.5 ? '#ff4d4d' : '#fffa65';
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.alpha -= this.decay * dt;
    }

    draw(ctx) {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.alpha);
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- Всплывающий текст (Комбо, Очки) ---
  class FloatingText {
    constructor(text, x, y, color = '#ffe600', size = 24) {
      this.text = text;
      this.x = x;
      this.y = y;
      this.color = color;
      this.size = size;
      this.vy = -60;
      this.alpha = 1;
      this.decay = 1.1;
    }

    update(dt) {
      this.y += this.vy * dt;
      this.alpha -= this.decay * dt;
    }

    draw(ctx) {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.alpha);
      ctx.font = `900 ${this.size}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = this.color;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 8;
      ctx.fillText(this.text, this.x, this.y);
      ctx.restore();
    }
  }

  // --- Сочные следы брызг сока на фоне (Fruit Ninja style) ---
  class BackgroundSplat {
    constructor(x, y, cutAngle = 0, isGolden = false) {
      this.x = x;
      this.y = y;
      this.angle = cutAngle; // Угол разреза (след ложится по свайпу)
      this.alpha = 0.42; // Сочный и заметный
      this.decay = randomRange(0.045, 0.08); // Постепенно растворяется / впитывается
      this.color = isGolden ? '#f59e0b' : '#facc15';
      this.innerColor = isGolden ? '#fef3c7' : '#fef9c3';

      // Размеры главного следа
      this.slashLength = randomRange(65, 120);
      this.slashWidth = randomRange(16, 28);

      // Органический неровный контур кляксы (не кругляк, а рваный сочный след)
      const pointsCount = 14;
      this.contour = [];
      for (let i = 0; i < pointsCount; i++) {
        const theta = (i / pointsCount) * Math.PI * 2;
        // Сильно вытягиваем вдоль оси X (направление удара)
        const stretchX = 1 + 1.2 * Math.pow(Math.cos(theta), 2);
        const radius = randomRange(10, 22) * stretchX;
        this.contour.push({
          x: Math.cos(theta) * radius * 1.3,
          y: Math.sin(theta) * radius * 0.45 + randomRange(-4, 4)
        });
      }

      // Разлетающиеся капли вокруг следа разреза
      this.droplets = [];
      const dropCount = Math.floor(randomRange(6, 12));
      for (let i = 0; i < dropCount; i++) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const distAlong = randomRange(-this.slashLength * 0.65, this.slashLength * 0.65);
        const distOut = randomRange(12, 38) * side;
        this.droplets.push({
          x: distAlong,
          y: distOut,
          r: randomRange(2.0, 5.5)
        });
      }

      // Тонкие струйки / брызги в стороны
      this.streaks = [];
      const streakCount = Math.floor(randomRange(2, 4));
      for (let i = 0; i < streakCount; i++) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const len = randomRange(35, this.slashLength * 0.85);
        this.streaks.push({
          x1: dir * randomRange(4, 12),
          y1: randomRange(-3, 3),
          x2: dir * len,
          y2: randomRange(-14, 14),
          w: randomRange(2.5, 4.5)
        });
      }
    }

    update(dt) {
      this.alpha -= this.decay * dt;
    }

    draw(ctx) {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      ctx.globalAlpha = Math.max(0, this.alpha);

      // 1. Тонкие струйки-подтеки сока по краям
      ctx.strokeStyle = this.color;
      ctx.lineCap = 'round';
      for (const streak of this.streaks) {
        ctx.lineWidth = streak.w;
        ctx.beginPath();
        ctx.moveTo(streak.x1, streak.y1);
        ctx.lineTo(streak.x2, streak.y2);
        ctx.stroke();
      }

      // 2. Основное органическое пятно-след свайпа
      ctx.fillStyle = this.color;
      ctx.beginPath();
      if (this.contour.length > 2) {
        ctx.moveTo(this.contour[0].x, this.contour[0].y);
        for (let i = 1; i < this.contour.length; i++) {
          const prev = this.contour[i - 1];
          const curr = this.contour[i];
          const midX = (prev.x + curr.x) / 2;
          const midY = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        }
        ctx.closePath();
      }
      ctx.fill();

      // 3. Более светлое «ядро» сока по центру среза
      ctx.fillStyle = this.innerColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, this.slashLength * 0.35, this.slashWidth * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();

      // 4. Отдельные капли сока вокруг следа
      ctx.fillStyle = this.color;
      for (const drop of this.droplets) {
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // --- Спавн волны фруктов ---
  function spawnWave() {
    // Количество объектов в волне зависит от текущего счета
    const maxItems = score > 150 ? 4 : (score > 60 ? 3 : 2);
    const count = Math.floor(randomRange(1, maxItems + 0.9));

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (gameState !== 'PLAYING') return;

        let type = 'LEMON';
        const rand = Math.random();

        // 35% лимон в разрезе, 15% бомба, 8% золотой лимон
        if (rand < 0.16 && score > 20) {
          type = 'BOMB';
        } else if (rand < 0.25) {
          type = 'GOLDEN';
        } else if (rand < 0.6) {
          type = 'CROSS_SECTION';
        }

        activeItems.push(new Item(type));
      }, i * 220);
    }

    // Случайный интервал до следующей волны (быстрее по мере роста счета)
    const minDelay = Math.max(0.9, 2.0 - score * 0.006);
    const maxDelay = Math.max(1.5, 2.8 - score * 0.008);
    nextSpawnInterval = randomRange(minDelay, maxDelay);
  }

  // --- Разрезание объектов ---
  function checkCuts(p1, p2) {
    if (gameState !== 'PLAYING') return;

    const cutAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let cutInThisSwipe = 0;

    for (let i = activeItems.length - 1; i >= 0; i--) {
      const item = activeItems[i];
      if (item.sliced) continue;

      const dist = distToSegment(item.x, item.y, p1.x, p1.y, p2.x, p2.y);
      if (dist < item.radius) {
        item.sliced = true;
        cutInThisSwipe++;
        handleItemSlice(item, cutAngle);
      }
    }

    if (cutInThisSwipe > 0) {
      currentSwipeCombo += cutInThisSwipe;
      lastCutTime = performance.now();

      // Оповещение о комбо, если срезали 2+ за один свайп
      if (currentSwipeCombo >= 2) {
        const bonus = currentSwipeCombo * 5;
        score += bonus;
        _shadowComboBonus += bonus;
        scoreEl.textContent = score;

        if (currentSwipeCombo > maxComboCount) {
          maxComboCount = currentSwipeCombo;
        }

        window.soundFX.playCombo(currentSwipeCombo);
        triggerHaptic('heavy');
        floatingTexts.push(
          new FloatingText(`КОМБО x${currentSwipeCombo}! +${bonus}`, p2.x, p2.y - 20, '#fffa65', 30)
        );
      }
    }
  }

  function handleItemSlice(item, cutAngle) {
    if (item.type === 'BOMB') {
      // Игрок разрезал бомбу!
      window.soundFX.playBomb();
      triggerHaptic('error');
      screenShake = 0.5;

      // Эффект взрыва
      for (let i = 0; i < 35; i++) {
        particles.push(new SparkParticle(item.x, item.y));
      }
      floatingTexts.push(new FloatingText('БОМБА!', item.x, item.y, '#ff3366', 36));

      // Теряем жизнь или мгновенный Game Over при бомбе
      loseLife(true);
      return;
    }

    // Разрезание лимона
    slicedLemonsCount++;
    const isGolden = item.type === 'GOLDEN';
    if (isGolden) goldenSlicedCount++;
    const points = isGolden ? 50 : 10;
    score += points;
    _shadowScore += points;
    scoreEl.textContent = score;

    if (isGolden) {
      window.soundFX.playGoldenSlice();
      triggerHaptic('heavy');
      floatingTexts.push(new FloatingText(`+${points} ЗОЛОТОЙ!`, item.x, item.y, '#ffd700', 28));
    } else {
      window.soundFX.playSlice();
      triggerHaptic('medium');
      floatingTexts.push(new FloatingText(`+${points}`, item.x, item.y, '#ffe600', 22));
    }

    // Создаем две половинки
    halfLemons.push(new HalfLemon(item.x, item.y, item.radius, cutAngle, -1, isGolden));
    halfLemons.push(new HalfLemon(item.x, item.y, item.radius, cutAngle, 1, isGolden));

    // Брызги сока
    const dropCount = isGolden ? 32 : 18;
    for (let i = 0; i < dropCount; i++) {
      particles.push(new JuiceDrop(item.x, item.y, isGolden));
    }

    // Сочный след удара/брызг на фоне
    backgroundSplats.push(new BackgroundSplat(item.x, item.y, cutAngle, isGolden));
    if (backgroundSplats.length > 14) {
      backgroundSplats.shift();
    }
  }

  function loseLife(instantGameOver = false) {
    if (instantGameOver) {
      lives = 0;
    } else {
      lives--;
      window.soundFX.playLoseLife();
      triggerHaptic('medium');
    }

    // Обновляем иконки жизней
    lifeIcons.forEach((icon, idx) => {
      if (idx >= lives) {
        icon.classList.add('lost');
      } else {
        icon.classList.remove('lost');
      }
    });

    if (lives <= 0) {
      if (!hasRevived) {
        showReviveScreen();
      } else {
        endGame();
      }
    }
  }

  // --- Lottie Анимация стикера ---
  function initLottieSticker() {
    const container = document.getElementById('lottie-lemon-container');
    if (!container || !window.lottie) return;

    if (lottiePlayer) {
      lottiePlayer.goToAndPlay(0, true);
      return;
    }

    try {
      lottiePlayer = window.lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://raw.githubusercontent.com/vovashmyhol/Lemon-tang/refs/heads/main/AgADhxAAAgdYMEo.json'
      });
    } catch (e) {
      console.warn("Lottie error", e);
    }
  }

  // --- Lottie Анимация для модалки Призов (lemon.json) ---
  let prizesLottiePlayer = null;
  function initPrizesLottie() {
    const container = document.getElementById('lottie-prizes-container');
    if (!container || !window.lottie) return;

    if (prizesLottiePlayer) {
      prizesLottiePlayer.goToAndPlay(0, true);
      return;
    }

    try {
      prizesLottiePlayer = window.lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://raw.githubusercontent.com/vovashmyhol/Lemon-tang/refs/heads/main/lemon.json'
      });
    } catch (e) {
      console.warn("Lottie prizes error", e);
    }
  }

  function openPrizesModal() {
    triggerHaptic('light');
    if (prizesScreen) {
      prizesScreen.classList.add('active');
      initPrizesLottie();
    }
  }

  function closePrizesModal() {
    triggerHaptic('light');
    if (prizesScreen) {
      prizesScreen.classList.remove('active');
    }
  }

  // --- Окно Возрождения (5 секунд обратный отсчет) ---
  function showReviveScreen() {
    gameState = 'REVIVE';
    reviveScreen.classList.add('active');
    document.getElementById('bottom-dock')?.classList.add('dock-hidden');
    initLottieSticker();

    const duration = 5.0; // 5 секунд
    const startTime = performance.now();
    reviveProgressFill.style.width = '100%';
    reviveCountdown.textContent = '(5.0с)';

    if (reviveTimerId) {
      cancelAnimationFrame(reviveTimerId);
      reviveTimerId = null;
    }

    function stepTimer() {
      if (gameState !== 'REVIVE') return;

      const elapsed = (performance.now() - startTime) / 1000;
      const remaining = Math.max(0, duration - elapsed);
      const ratio = remaining / duration;

      reviveProgressFill.style.width = (ratio * 100).toFixed(1) + '%';
      reviveCountdown.textContent = `(${remaining.toFixed(1)}с)`;

      if (remaining <= 0) {
        reviveScreen.classList.remove('active');
        endGame();
      } else {
        reviveTimerId = requestAnimationFrame(stepTimer);
      }
    }

    reviveTimerId = requestAnimationFrame(stepTimer);
  }

  function revivePlayer() {
    reviveCount++;
    hasRevived = false; // Позволяет брать продолжение снова, если игрок готов оплачивать
    lives = 3;
    lifeIcons.forEach(icon => icon.classList.remove('lost'));

    // Убираем бомбы с экрана, чтобы не подорваться сразу после возврата
    activeItems = activeItems.filter(item => item.type !== 'BOMB');

    window.soundFX.playGoldenSlice();
    triggerHaptic('heavy');

    reviveScreen.classList.remove('active');
    gameState = 'PLAYING';
    document.getElementById('bottom-dock')?.classList.add('dock-hidden');
  }

  function endGame() {
    gameState = 'GAMEOVER';

    if (reviveTimerId) {
      cancelAnimationFrame(reviveTimerId);
      reviveTimerId = null;
    }

    previousBestScore = bestScore;
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('lemon_ninja_best', bestScore.toString());
      if (menuBestScoreEl) menuBestScoreEl.textContent = bestScore;
    }

    finalScoreEl.textContent = score;
    finalBestEl.textContent = bestScore;
    finalLemonsEl.textContent = slicedLemonsCount;
    finalComboEl.textContent = `x${maxComboCount}`;
    if (finalRevivesEl) finalRevivesEl.textContent = reviveCount;

    // Сброс статуса проверки античита
    if (verifyStatusEl) {
      verifyStatusEl.className = 'verify-status hidden';
      verifyStatusEl.textContent = '';
    }
    if (primaryMetricCard) {
      primaryMetricCard.classList.remove('tamper-reset', 'tamper-ok');
    }

    setTimeout(() => {
      gameOverScreen.classList.add('active');
      document.getElementById('bottom-dock')?.classList.remove('dock-hidden');
    }, 450);
  }

  function startGame() {
    window.soundFX.init();
    score = 0;
    lives = 3;
    hasRevived = false;
    reviveCount = 0;
    slicedLemonsCount = 0;
    goldenSlicedCount = 0;
    maxComboCount = 0;
    _shadowScore = 0;
    _shadowComboBonus = 0;
    activeItems = [];
    halfLemons = [];
    particles = [];
    floatingTexts = [];
    backgroundSplats = [];
    touchTrail = [];
    spawnTimer = 0;

    if (reviveTimerId) {
      cancelAnimationFrame(reviveTimerId);
      reviveTimerId = null;
    }

    scoreEl.textContent = '0';
    lifeIcons.forEach(icon => icon.classList.remove('lost'));

    startScreen.classList.remove('active');
    reviveScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    prizesScreen?.classList.remove('active');
    document.getElementById('bottom-dock')?.classList.add('dock-hidden');

    gameState = 'PLAYING';
    triggerHaptic('light');
  }

  // --- Обработка ввода (Touch + Mouse) ---
  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      time: performance.now()
    };
  }

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    if (e.cancelable) e.preventDefault();
    window.soundFX.init();
    isPointerDown = true;
    currentSwipeCombo = 0;
    touchTrail = [getPointerPos(e)];
  }

  function onPointerMove(e) {
    if (!isPointerDown) return;
    if (e.cancelable) e.preventDefault();
    const pt = getPointerPos(e);
    const lastPt = touchTrail[touchTrail.length - 1];

    if (lastPt) {
      const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
      if (dist > 18) {
        window.soundFX.playSwish();
      }
      // Проверяем срез на отрезке
      checkCuts(lastPt, pt);
    }

    touchTrail.push(pt);
  }

  function onPointerUp(e) {
    if (isPointerDown && e && e.cancelable) e.preventDefault();
    isPointerDown = false;
    currentSwipeCombo = 0;
  }

  // Мышь
  window.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  // Тач-события с { passive: false } для предотвращения закрытия Telegram Mini App
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove', onPointerMove, { passive: false });
  canvas.addEventListener('touchend', onPointerUp, { passive: false });
  canvas.addEventListener('touchcancel', onPointerUp, { passive: false });

  // Глобальная блокировка свайпа закрытия во время нарезки лимонов
  window.addEventListener('touchmove', (e) => {
    if (gameState === 'PLAYING' && e.cancelable) {
      e.preventDefault();
    }
  }, { passive: false });

  // Кнопки интерфейса
  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // Кнопка проверки результата (античит)
  verifyBtn.addEventListener('click', () => {
    if (verifyBtn.classList.contains('verifying')) return;

    triggerHaptic('light');
    verifyBtn.classList.remove('verified', 'cheat-detected');
    verifyBtn.classList.add('verifying');

    // На время проверки скрываем прошлый статус и сбрасываем стили карточки
    if (verifyStatusEl) {
      verifyStatusEl.className = 'verify-status hidden';
      verifyStatusEl.textContent = '';
    }
    if (primaryMetricCard) {
      primaryMetricCard.classList.remove('tamper-reset', 'tamper-ok');
    }

    setTimeout(() => {
      verifyBtn.classList.remove('verifying');

      // 1. Честный расчёт из фактических игровых событий
      const realBase = (slicedLemonsCount - goldenSlicedCount) * 10 + goldenSlicedCount * 50;
      const realScore = realBase + _shadowComboBonus;

      // 2. Считываем то, что сейчас отображается на экране в DOM
      const displayedScore = parseInt(finalScoreEl.textContent.trim(), 10);
      const isTampered = isNaN(displayedScore) || displayedScore !== realScore || score !== realScore;

      if (isTampered) {
        // НАКРУТКА ОБНАРУЖЕНА! Перезагружаем результат до честного!
        triggerHaptic('error');
        window.soundFX.playBomb();

        // Перезаписываем отображение и внутреннее состояние
        finalScoreEl.textContent = realScore;
        score = realScore;

        // Если из-за накрутки был испорчен рекорд — откатываем
        bestScore = Math.max(previousBestScore, realScore);
        localStorage.setItem('lemon_ninja_best', bestScore.toString());
        finalBestEl.textContent = bestScore;
        if (menuBestScoreEl) menuBestScoreEl.textContent = bestScore;

        // Визуальная реакция: тряска карточки + красный цвет
        if (primaryMetricCard) {
          primaryMetricCard.classList.remove('tamper-ok');
          void primaryMetricCard.offsetWidth;
          primaryMetricCard.classList.add('tamper-reset');
        }

        // Показываем плашку с информацией о сбросе
        if (verifyStatusEl) {
          verifyStatusEl.className = 'verify-status status-tampered';
          const fakeVal = isNaN(displayedScore) ? '???' : displayedScore;
          verifyStatusEl.innerHTML = `⚠️ Накрутка удалена! Счёт: <span style="text-decoration:line-through;opacity:0.75">${fakeVal}</span> ➔ <b>${realScore}</b>`;
        }

        // Кнопка показывает предупреждающий значок
        verifyBtn.classList.add('cheat-detected');
        verifyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>`;

        setTimeout(() => {
          verifyBtn.classList.remove('cheat-detected');
          verifyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>`;
        }, 2500);

      } else {
        // ВСЁ ЧЕСТНО! Подтверждаем результат
        triggerHaptic('medium');

        if (primaryMetricCard) {
          primaryMetricCard.classList.remove('tamper-reset');
          void primaryMetricCard.offsetWidth;
          primaryMetricCard.classList.add('tamper-ok');
        }

        if (verifyStatusEl) {
          verifyStatusEl.className = 'verify-status status-ok';
          verifyStatusEl.innerHTML = `Данные подлинны: <b>${realScore}</b> очков`;
        }

        verifyBtn.classList.add('verified');
        verifyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>`;

        setTimeout(() => {
          verifyBtn.classList.remove('verified');
          verifyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>`;
        }, 2000);
      }
    }, 900);
  });

  // Кнопка «Поделиться в Telegram»
  shareBtn.addEventListener('click', () => {
    triggerHaptic('medium');

    const currentScore = parseInt(finalScoreEl.textContent.trim(), 10) || score;
    const shareText = `🍋 Я набрал ${currentScore} очков, иду на победу главного приза ))`;

    // Ссылка на бот Lemon Tang
    const appUrl = 'https://t.me/TangLemonBot';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(appUrl)}&text=${encodeURIComponent(shareText)}`;

    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  });

  // Кнопки открытия модалки Призов (под «Начать игру» и «Сыграть снова»)
  openPrizesBtns.forEach(btn => {
    btn.addEventListener('click', openPrizesModal);
  });

  if (prizesBackBtn) {
    prizesBackBtn.addEventListener('click', closePrizesModal);
  }

  if (prizesChannelBtn) {
    prizesChannelBtn.addEventListener('click', () => {
      triggerHaptic('medium');
      const channelUrl = 'https://t.me/voco_in';
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(channelUrl);
      } else {
        window.open(channelUrl, '_blank');
      }
    });
  }

  // Закрытие по клику на затемненный фон модалки
  if (prizesScreen) {
    prizesScreen.addEventListener('click', (e) => {
      if (e.target === prizesScreen) {
        closePrizesModal();
      }
    });
  }

  reviveBtn.addEventListener('click', () => {
    if (gameState !== 'REVIVE') return;

    // Останавливаем таймер на время оплаты
    if (reviveTimerId) {
      cancelAnimationFrame(reviveTimerId);
      reviveTimerId = null;
    }

    triggerHaptic('medium');

    const invoiceUrl = 'https://t.me/$HoGjOhHu4EmvEgAAvXXzp7_dB8A';

    if (tg?.openInvoice) {
      tg.openInvoice(invoiceUrl, (status) => {
        if (status === 'paid') {
          revivePlayer();
        } else {
          // Если пользователь закрыл счёт или не оплатил
          reviveScreen.classList.remove('active');
          endGame();
        }
      });
    } else {
      // При тестировании в обычном браузере
      const testPaid = confirm("Telegram Stars Invoice:\n10 ⭐ за возобновление игры.\n\nПодтвердить оплату и продолжить?");
      if (testPaid) {
        revivePlayer();
      } else {
        reviveScreen.classList.remove('active');
        endGame();
      }
    }
  });

  soundBtn.addEventListener('click', () => {
    window.soundFX.init();
    const isEnabled = window.soundFX.toggle();
    if (isEnabled) {
      soundIconOn.classList.remove('hidden');
      soundIconOff.classList.add('hidden');
    } else {
      soundIconOn.classList.add('hidden');
      soundIconOff.classList.remove('hidden');
    }
    triggerHaptic('light');
  });

  // --- Рисование следа лезвия (Blade Trail) ---
  function drawBladeTrail(ctx) {
    const now = performance.now();
    // Оставляем только свежие точки за последние 160 мс
    touchTrail = touchTrail.filter(pt => now - pt.time < 160);

    if (touchTrail.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Внешнее свечение
    for (let i = 1; i < touchTrail.length; i++) {
      const p1 = touchTrail[i - 1];
      const p2 = touchTrail[i];
      const ageRatio = 1 - (now - p2.time) / 160;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = `rgba(255, 230, 0, ${ageRatio * 0.7})`;
      ctx.lineWidth = 14 * ageRatio;
      ctx.stroke();
    }

    // Внутреннее белое острие
    for (let i = 1; i < touchTrail.length; i++) {
      const p1 = touchTrail[i - 1];
      const p2 = touchTrail[i];
      const ageRatio = 1 - (now - p2.time) / 160;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = `rgba(255, 255, 255, ${ageRatio})`;
      ctx.lineWidth = 4 * ageRatio;
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- Главный цикл игры (Game Loop) ---
  let lastTimestamp = performance.now();

  function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;

    // Обновление таймера спавна
    if (gameState === 'PLAYING') {
      spawnTimer += dt;
      if (spawnTimer >= nextSpawnInterval) {
        spawnTimer = 0;
        spawnWave();
      }
    }

    // Тряска экрана при взрыве
    ctx.save();
    if (screenShake > 0) {
      screenShake -= dt;
      const shakeMag = screenShake * 22;
      ctx.translate(randomRange(-shakeMag, shakeMag), randomRange(-shakeMag, shakeMag));
    }

    // Очистка экрана
    ctx.clearRect(0, 0, width, height);

    // 1. Пятна сока на заднем плане
    for (let i = backgroundSplats.length - 1; i >= 0; i--) {
      const splat = backgroundSplats[i];
      splat.update(dt);
      splat.draw(ctx);
      if (splat.alpha <= 0) {
        backgroundSplats.splice(i, 1);
      }
    }

    // 2. Половинки лимонов
    for (let i = halfLemons.length - 1; i >= 0; i--) {
      const half = halfLemons[i];
      half.update(dt);
      half.draw(ctx);
      if (half.y > height + 100) {
        halfLemons.splice(i, 1);
      }
    }

    // 3. Активные летящие фрукты и бомбы
    for (let i = activeItems.length - 1; i >= 0; i--) {
      const item = activeItems[i];
      if (gameState === 'PLAYING') {
        item.update(dt);
      }

      if (!item.sliced) {
        item.draw(ctx);
      }

      // Проверка падения за пределы экрана (только во время активной игры)
      if (gameState === 'PLAYING' && item.y > height + 80) {
        if (!item.sliced && (item.type === 'LEMON' || item.type === 'CROSS_SECTION')) {
          // Игрок упустил целый лимон!
          loseLife(false);
        }
        activeItems.splice(i, 1);
      }
    }

    // 4. Частицы сока и искр
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update(dt);
      p.draw(ctx);
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      }
    }

    // 5. Всплывающий текст
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.update(dt);
      ft.draw(ctx);
      if (ft.alpha <= 0) {
        floatingTexts.splice(i, 1);
      }
    }

    // 6. След лезвия свайпа
    drawBladeTrail(ctx);

    ctx.restore();

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
})();
