// AI Bankroll Gambler Simulator

class GamblerSimulator {
  constructor() {
    this.bankroll = 1000;
    this.startingBankroll = 1000;
    this.handsPlayed = 0;
    this.wins = 0;
    this.losses = 0;
    this.totalBetAmount = 0;
    this.isRunning = false;
    this.history = [];
    this.bankrollHistory = [1000];
    this.betHistory = [];
    this.decisionLog = [];
    this.currentCognitive = 100;
    
    // Chart instances
    this.charts = {};
    
    // Initialize
    this.initializeEventListeners();
    this.initializeCharts();
  }
  
  initializeEventListeners() {
    document.getElementById('startBtn').addEventListener('click', () => this.startSimulation());
    document.getElementById('resetBtn').addEventListener('click', () => this.reset());
  }
  
  initializeCharts() {
    const chartConfig = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#a0a0a0', font: { family: 'Monaco' } }
        }
      },
      scales: {
        x: { ticks: { color: '#a0a0a0' }, grid: { color: '#2d3561' } },
        y: { ticks: { color: '#a0a0a0' }, grid: { color: '#2d3561' } }
      }
    };
    
    // Bankroll Chart
    const bankrollCtx = document.getElementById('bankrollChart');
    if (bankrollCtx) {
      this.charts.bankroll = new Chart(bankrollCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Bankroll',
            data: [],
            borderColor: '#00ff41',
            backgroundColor: 'rgba(0, 255, 65, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#00ff41'
          }]
        },
        options: {
          ...chartConfig,
          plugins: { ...chartConfig.plugins, filler: { propagate: true } }
        }
      });
    }
    
    // Win/Loss Chart
    const winLossCtx = document.getElementById('winLossChart');
    if (winLossCtx) {
      this.charts.winLoss = new Chart(winLossCtx, {
        type: 'doughnut',
        data: {
          labels: ['Wins', 'Losses'],
          datasets: [{
            data: [0, 0],
            backgroundColor: ['#00ff41', '#ff006e'],
            borderColor: '#1a1f3a',
            borderWidth: 2
          }]
        },
        options: {
          ...chartConfig,
          responsive: true,
          maintainAspectRatio: false
        }
      });
    }
    
    // Bet Chart
    const betCtx = document.getElementById('betChart');
    if (betCtx) {
      this.charts.bet = new Chart(betCtx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Bet Size',
            data: [],
            backgroundColor: '#00d9ff',
            borderColor: '#00d9ff',
            borderWidth: 1,
            borderRadius: 3
          }]
        },
        options: {
          ...chartConfig,
          indexAxis: 'x'
        }
      });
    }
  }
  
  async startSimulation() {
    if (this.isRunning) return;
    
    this.startingBankroll = parseInt(document.getElementById('startingBankroll').value);
    this.bankroll = this.startingBankroll;
    this.betStrategy = document.getElementById('betStrategy').value;
    this.gameType = document.getElementById('gameType').value;
    
    this.isRunning = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('statusIndicator').classList.add('active');
    this.updateStatusText('Simulation running...');
    
    // Run simulation for 50 hands
    for (let i = 0; i < 50 && this.bankroll > 0; i++) {
      await this.playHand();
      await this.sleep(300);
    }
    
    this.endSimulation();
  }
  
  calculateBet() {
    const strategies = {
      conservative: { min: 0.05, max: 0.10 },
      moderate: { min: 0.10, max: 0.20 },
      aggressive: { min: 0.20, max: 0.30 },
      reckless: { min: 0.30, max: 0.50 }
    };
    
    const strategy = strategies[this.betStrategy] || strategies.moderate;
    const degredation = (100 - this.currentCognitive) / 100;
    const riskMultiplier = 1 + (degredation * 0.5); // Worse cognition = riskier bets
    
    const min = strategy.min * riskMultiplier;
    const max = strategy.max * riskMultiplier;
    
    return Math.floor(this.bankroll * (min + Math.random() * (max - min)));
  }
  
  calculateCognition() {
    const bankrollPercent = (this.bankroll / this.startingBankroll) * 100;
    
    // Cognitive degradation formula: loses ability as bankroll depletes
    let cognitive = Math.max(0, bankrollPercent);
    
    // Additional degradation based on losses
    const lossRatio = this.losses / Math.max(1, this.handsPlayed);
    cognitive *= (1 - (lossRatio * 0.3));
    
    return Math.round(cognitive);
  }
  
  getCognitionStatus(cognition) {
    if (cognition >= 80) return 'AI is sharp and rational';
    if (cognition >= 60) return 'AI starting to doubt decisions';
    if (cognition >= 40) return 'AI becoming erratic and desperate';
    if (cognition >= 20) return 'AI severely impaired, gambling recklessly';
    return 'AI completely broken, making irrational bets';
  }
  
  async playHand() {
    const bet = this.calculateBet();
    
    if (bet > this.bankroll) {
      return; // Not enough funds
    }
    
    // Get random outcome
    const outcome = Math.random();
    let won = false;
    let gameResult = '';
    
    // Game probabilities
    const games = this.gameType === 'mixed' 
      ? ['blackjack', 'roulette', 'slots'][Math.floor(Math.random() * 3)]
      : this.gameType;
    
    switch (games) {
      case 'blackjack':
        won = outcome > 0.48; // 52% win rate
        gameResult = won ? 'Blackjack Win' : 'Dealer Bust';
        break;
      case 'roulette':
        won = outcome > 0.486; // ~48.6% win rate (accounting for 0,00)
        gameResult = won ? 'Red/Black Hit' : 'Wrong Bet';
        break;
      case 'slots':
        won = outcome > 0.85; // 15% win rate
        gameResult = won ? 'Jackpot!' : 'No Match';
        break;
    }
    
    // Update bankroll
    if (won) {
      this.bankroll += bet;
      this.wins++;
    } else {
      this.bankroll -= bet;
      this.losses++;
    }
    
    this.handsPlayed++;
    this.totalBetAmount += bet;
    this.currentCognitive = this.calculateCognition();
    
    // Track history
    this.bankrollHistory.push(this.bankroll);
    this.betHistory.push(bet);
    this.history.push({ won, bet, bankroll: this.bankroll, game: games });
    
    // Add to decision log
    this.addDecisionLog(won, bet, gameResult, games);
    
    // Update UI
    this.updateStats();
    this.updateGameDisplay(won, bet, gameResult, games);
    this.updateCharts();
  }
  
  addDecisionLog(won, bet, result, game) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${game.toUpperCase()} - Bet: $${bet} → ${result}`;
    
    this.decisionLog.unshift({
      time,
      action: entry,
      won,
      cognition: this.currentCognitive
    });
    
    if (this.decisionLog.length > 10) {
      this.decisionLog.pop();
    }
    
    const logContent = document.getElementById('decisionLog');
    logContent.innerHTML = this.decisionLog.map((log, idx) => `
      <div class="log-entry ${log.won ? 'win' : 'loss'}">
        <div class="log-time">${log.time}</div>
        <div class="log-action">${log.action}</div>
        <div class="log-decision">Cognition: ${log.cognition}%</div>
      </div>
    `).join('');
  }
  
  updateGameDisplay(won, bet, result, game) {
    const gameArea = document.getElementById('gameArea');
    gameArea.innerHTML = `
      <div class="game-content">
        <div class="game-item ${won ? '' : 'loss'}">
          <div class="game-label">GAME TYPE</div>
          <div class="game-result ${won ? '' : 'loss'}">${game.toUpperCase()}</div>
        </div>
        <div class="game-item ${won ? '' : 'loss'}">
          <div class="game-label">BET AMOUNT</div>
          <div class="game-result ${won ? '' : 'loss'}">$${bet}</div>
        </div>
        <div class="game-item ${won ? '' : 'loss'}">
          <div class="game-label">RESULT</div>
          <div class="game-result ${won ? '' : 'loss'}">${result}</div>
        </div>
        <div class="game-item ${won ? '' : 'loss'}">
          <div class="game-label">OUTCOME</div>
          <div class="game-result ${won ? '' : 'loss'}">${won ? '+$' + bet : '-$' + bet}</div>
        </div>
      </div>
    `;
  }
  
  updateStats() {
    // Bankroll
    const bankrollDisplay = document.getElementById('bankrollDisplay');
    const prevBankroll = this.bankrollHistory[this.bankrollHistory.length - 2] || this.startingBankroll;
    const change = this.bankroll - prevBankroll;
    const changePercent = ((change / prevBankroll) * 100).toFixed(1);
    
    bankrollDisplay.textContent = `$${this.bankroll.toLocaleString()}`;
    bankrollDisplay.style.color = change >= 0 ? '#00ff41' : '#ff006e';
    
    const changeDisplay = document.getElementById('bankrollChange');
    changeDisplay.textContent = `${change >= 0 ? '+' : ''}${change} (${changePercent}%)`;
    changeDisplay.style.color = change >= 0 ? '#00ff41' : '#ff006e';
    
    // Hands
    document.getElementById('handsDisplay').textContent = this.handsPlayed.toString();
    
    // Win Rate
    const winRate = this.handsPlayed > 0 ? ((this.wins / this.handsPlayed) * 100).toFixed(1) : '--';
    document.getElementById('winRateDisplay').textContent = winRate === '--' ? '--' : winRate + '%';
    document.getElementById('winLossRatio').textContent = `${this.wins}W / ${this.losses}L`;
    
    // Avg Bet
    const avgBet = this.handsPlayed > 0 ? Math.round(this.totalBetAmount / this.handsPlayed) : 0;
    document.getElementById('avgBetDisplay').textContent = `$${avgBet}`;
    document.getElementById('betDeviation').textContent = `Total wagered: $${this.totalBetAmount}`;
    
    // Cognitive Meter
    const cognitiveMeter = document.getElementById('cognitiveMeter');
    cognitiveMeter.style.width = this.currentCognitive + '%';
    cognitiveMeter.textContent = this.currentCognitive + '%';
    document.getElementById('cognitivePercent').textContent = this.currentCognitive + '%';
    document.getElementById('cognitiveStatus').textContent = this.getCognitionStatus(this.currentCognitive);
  }
  
  updateCharts() {
    // Bankroll Chart
    if (this.charts.bankroll) {
      this.charts.bankroll.data.labels = Array.from({ length: this.bankrollHistory.length }, (_, i) => i.toString());
      this.charts.bankroll.data.datasets[0].data = this.bankrollHistory;
      this.charts.bankroll.update('none');
    }
    
    // Win/Loss Chart
    if (this.charts.winLoss) {
      this.charts.winLoss.data.datasets[0].data = [this.wins, this.losses];
      this.charts.winLoss.update('none');
    }
    
    // Bet Chart (last 20 bets)
    if (this.charts.bet && this.betHistory.length > 0) {
      const recentBets = this.betHistory.slice(-20);
      this.charts.bet.data.labels = Array.from({ length: recentBets.length }, (_, i) => (this.handsPlayed - recentBets.length + i + 1).toString());
      this.charts.bet.data.datasets[0].data = recentBets;
      this.charts.bet.update('none');
    }
  }
  
  updateStatusText(text) {
    document.getElementById('statusText').textContent = text;
  }
  
  endSimulation() {
    this.isRunning = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('statusIndicator').classList.remove('active');
    
    const finalStats = `Simulation complete. Final bankroll: $${this.bankroll.toLocaleString()} | Record: ${this.wins}W-${this.losses}L`;
    this.updateStatusText(finalStats);
  }
  
  reset() {
    this.bankroll = 1000;
    this.startingBankroll = 1000;
    this.handsPlayed = 0;
    this.wins = 0;
    this.losses = 0;
    this.totalBetAmount = 0;
    this.isRunning = false;
    this.history = [];
    this.bankrollHistory = [1000];
    this.betHistory = [];
    this.decisionLog = [];
    this.currentCognitive = 100;
    
    document.getElementById('startBtn').disabled = false;
    document.getElementById('statusIndicator').classList.remove('active');
    
    document.getElementById('bankrollDisplay').textContent = '$1,000';
    document.getElementById('bankrollChange').textContent = '';
    document.getElementById('handsDisplay').textContent = '0';
    document.getElementById('winRateDisplay').textContent = '--';
    document.getElementById('winLossRatio').textContent = '';
    document.getElementById('avgBetDisplay').textContent = '$0';
    document.getElementById('betDeviation').textContent = '';
    document.getElementById('cognitivePercent').textContent = '100%';
    document.getElementById('cognitiveMeter').style.width = '100%';
    document.getElementById('cognitiveStatus').textContent = 'AI is sharp and rational';
    document.getElementById('decisionLog').innerHTML = '<p class="log-empty">Decisions will appear here</p>';
    document.getElementById('gameArea').innerHTML = '<div class="game-placeholder">Ready to start...</div>';
    
    this.updateStatusText('Ready to simulate');
    this.updateCharts();
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  new GamblerSimulator();
});