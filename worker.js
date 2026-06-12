const AMAP_API_URL = 'https://restapi.amap.com/v3/weather/weatherInfo';

const HOT_CITIES = [
  '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安',
  '南京', '重庆', '天津', '苏州', '长沙', '沈阳', '青岛', '郑州',
  '大连', '厦门', '福州', '东莞', '宁波', '无锡', '合肥', '佛山'
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }
    
    const cfData = request.cf || {};
    let ipCity = (cfData.city || cfData.region || '北京').replace(/市$/, '');
    const userCity = url.searchParams.get('city');
    const city = userCity || ipCity;
    
    const debug = {
      hasApiKey: !!env.AMAP_API_KEY,
      apiKeyFirst10: env.AMAP_API_KEY ? env.AMAP_API_KEY.substring(0, 10) + '...' : '未配置',
      ipCity: ipCity,
      userCity: userCity,
      finalCity: city,
      cfAvailable: !!request.cf
    };
    
    try {
      // ========== 关键：检查API Key ==========
      if (!env.AMAP_API_KEY) {
        throw new Error('❌ 未配置 AMAP_API_KEY 环境变量！请在Cloudflare Workers设置中添加');
      }
      
      const weatherData = await fetchWeather(env.AMAP_API_KEY, city);
      debug.apiSuccess = true;
      
      return new Response(renderHTML(city, weatherData, debug), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
      
    } catch (error) {
      debug.error = error.message;
      debug.apiSuccess = false;
      return new Response(renderErrorPage(error.message, debug), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }
};

async function fetchWeather(apiKey, city) {
  const params = new URLSearchParams({
    key: apiKey,
    city: city,
    extensions: 'all',
    output: 'json'
  });
  
  const response = await fetch(`${AMAP_API_URL}?${params}`);
  const data = await response.json();
  
  if (data.status !== '1') {
    const errorMap = {
      'INVALID_USER_KEY': 'API Key无效，请检查是否正确',
      'USER_DAILY_QUERY_OVER_LIMIT': '今日API调用次数已超限',
      'INSUFFICIENT_PRIVILEGES': 'Key没有Web服务权限，请去高德控制台开通',
      'NO_DATA': '该城市无天气数据'
    };
    throw new Error(errorMap[data.info] || `高德API错误: ${data.info}`);
  }
  
  return data;
}

function handleCORS() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
}

function renderHTML(currentCity, data, debug) {
  const lives = data.lives && data.lives[0];
  const forecasts = data.forecasts && data.forecasts[0];
  
  const chartData = forecasts && forecasts.casts ? JSON.stringify({
    dates: forecasts.casts.map(c => c.date.slice(5)),
    dayTemps: forecasts.casts.map(c => c.daytemp),
    nightTemps: forecasts.casts.map(c => c.nighttemp)
  }) : 'null';
  
  const cityOptions = HOT_CITIES.map(c => 
    `<option value="${c}" ${c === currentCity ? 'selected' : ''}>${c}</option>`
  ).join('');
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>天气 - ${currentCity}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; padding: 16px;
    }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { text-align: center; color: white; margin: 10px 0 20px; font-size: 1.5rem; }
    
    .debug-bar {
      background: #fff3cd; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px;
      font-size: 0.85rem; color: #856404;
    }
    .debug-bar.success { background: #d4edda; color: #155724; }
    
    .city-selector {
      background: white; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px;
      display: flex; justify-content: space-between; align-items: center;
    }
    #citySelect { padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; }
    
    .card {
      background: white; border-radius: 16px; padding: 20px; margin-bottom: 16px;
      box-shadow: 0 8px 25px rgba(0,0,0,0.1);
    }
    .card h2 { color: #333; margin-bottom: 16px; font-size: 1.15rem; }
    
    .weather-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; }
    .weather-item {
      text-align: center; padding: 14px; background: #f8f9ff; border-radius: 10px;
      display: flex; flex-direction: column; justify-content: center;
    }
    .weather-item.temp-card {
      background: linear-gradient(135deg, #667eea, #764ba2); color: white;
      grid-row: span 2;
    }
    .main-temp { font-size: 3rem; font-weight: 700; }
    .main-weather { font-size: 1rem; margin-top: 6px; }
    .weather-item .label { color: #888; font-size: 0.8rem; margin-bottom: 6px; }
    .weather-item .value { color: #333; font-weight: 600; }
    
    .forecast-list { display: flex; flex-direction: column; }
    .forecast-item {
      display: grid; grid-template-columns: 70px 1fr 90px; align-items: center;
      padding: 12px 0; border-bottom: 1px solid #f0f0f0;
    }
    .forecast-item:last-child { border-bottom: none; }
    
    .chart-container { height: 260px; }
    .tip { text-align: center; color: rgba(255,255,255,0.8); margin-top: 20px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌍 实时天气查询</h1>
    
    <div class="debug-bar ${debug.apiSuccess ? 'success' : ''}">
      ✅ API Key: ${debug.hasApiKey ? '已配置' : '❌ 未配置'} | 
      IP定位: ${debug.ipCity} | 
      查询城市: ${debug.finalCity}
    </div>
    
    <div class="city-selector">
      <span>📍 当前: ${currentCity}</span>
      <select id="citySelect">
        <option value="" disabled>切换城市</option>
        ${cityOptions}
      </select>
    </div>
    
    ${lives ? `
    <div class="card">
      <h2>🌤️ 实时天气</h2>
      <div class="weather-grid">
        <div class="weather-item temp-card">
          <div class="main-temp">${lives.temperature}°</div>
          <div class="main-weather">${lives.weather}</div>
        </div>
        <div class="weather-item"><span class="label">湿度</span><span class="value">${lives.humidity}%</span></div>
        <div class="weather-item"><span class="label">风向</span><span class="value">${lives.winddirection}</span></div>
        <div class="weather-item"><span class="label">风力</span><span class="value">${lives.windpower}级</span></div>
      </div>
    </div>
    ` : ''}
    
    ${forecasts ? `
    <div class="card">
      <h2>📅 未来5日预报</h2>
      <div class="forecast-list">
        ${forecasts.casts.map(cast => `
          <div class="forecast-item">
            <div><div class="date">${cast.date.slice(5)}</div><div style="color:#667eea;font-size:0.8rem">${getWeekDay(cast.week)}</div></div>
            <div>
              <div style="color:#f57c00">☀️ ${cast.dayweather} ${cast.daytemp}°</div>
              <div style="color:#1976d2">🌙 ${cast.nightweather} ${cast.nighttemp}°</div>
            </div>
            <div style="color:#666;font-size:0.85rem">${cast.daywind} ${cast.daypower}级</div>
          </div>
        `).join('')}
      </div>
      <div class="chart-container" style="margin-top:20px"><canvas id="tempChart"></canvas></div>
    </div>
    ` : ''}
    
    <div class="tip">数据来源：高德天气 API</div>
  </div>
  
  <script>
    const chartData = ${chartData};
    
    document.getElementById('citySelect').addEventListener('change', function(e) {
      if (e.target.value) {
        const url = new URL(window.location.href);
        url.searchParams.set('city', e.target.value);
        window.location.href = url.toString();
      }
    });
    
    if (chartData) {
      const ctx = document.getElementById('tempChart').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: chartData.dates,
          datasets: [{
            label: '白天', data: chartData.dayTemps,
            borderColor: '#ff6b6b', backgroundColor: 'rgba(255,107,107,0.1)',
            borderWidth: 3, fill: true, tension: 0.4
          }, {
            label: '夜间', data: chartData.nightTemps,
            borderColor: '#4ecdc4', backgroundColor: 'rgba(78,205,196,0.1)',
            borderWidth: 3, fill: true, tension: 0.4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }
  </script>
</body>
</html>
  `;
}
function getWeekDay(n) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][n % 7];
}
