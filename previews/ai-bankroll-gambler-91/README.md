# AI Bankroll Gambler Simulator

A web application that simulates an AI agent's gambling behavior as it depletes its virtual bankroll. Watch in real-time as decision-making degrades and risk-taking increases as funds run out.

## Features

✨ **Real-time Bankroll Tracking** - Live balance display with change indicators and history

✨ **AI Cognitive Performance Meter** - Visual degradation of decision-making quality as bankroll depletes

✨ **Multiple Game Types** - Blackjack, Roulette, Slots, or Mixed games with realistic win rates

✨ **Dynamic Bet Strategy** - AI adjusts betting based on bankroll health and cognitive status

✨ **Historical Analytics** - Comprehensive charts tracking:
- Bankroll progression over time
- Win/Loss distribution (Doughnut chart)
- Bet size evolution (Bar chart)

✨ **Decision Logging** - Real-time log of the AI's decisions, outcomes, and cognitive state

✨ **Configurable Simulation** - Adjust starting bankroll, bet strategy, and game type before each run

## How It Works

### Cognitive Degradation Model

The AI's cognitive performance (0-100%) is calculated based on:
- **Bankroll depletion**: Direct correlation between remaining funds and mental clarity
- **Loss streaks**: Losing hands further reduce cognitive performance
- **Bet recklessness**: Lower cognition triggers riskier betting patterns

### Bet Strategy Tiers

- **Conservative**: 5-10% of bankroll per hand
- **Moderate**: 10-20% of bankroll per hand (default)
- **Aggressive**: 20-30% of bankroll per hand
- **Reckless**: 30-50% of bankroll per hand

As cognitive performance drops, the AI becomes more reckless with bet sizing.

### Game Probabilities

- **Blackjack**: 52% win rate (house edge: 2%)
- **Roulette**: ~48.6% win rate (accounting for 0 and 00)
- **Slots**: 15% win rate (typical casino payout)

## Installation

### Local Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ai-bankroll-gambler.git
cd ai-bankroll-gambler
```

2. Open `index.html` in a modern web browser:
```bash
open index.html
```

Or use a local server (Python 3):
```bash
python -m http.server 8000
# Visit http://localhost:8000
```

Or with Node.js (http-server):
```bash
npx http-server
# Visit http://localhost:8080
```

## Usage

1. **Configure the Simulation**:
   - Set starting bankroll (default: $1,000)
   - Choose bet strategy (Conservative → Reckless)
   - Select game type (Blackjack, Roulette, Slots, or Mixed)

2. **Start the Simulation**:
   - Click "Start Simulation"
   - Watch as the AI plays 50 hands
   - Observe cognitive degradation in real-time

3. **Analyze Results**:
   - Monitor bankroll history chart
   - Check win/loss distribution
   - Review bet size progression
   - Read decision log for detailed action history

4. **Reset and Retry**:
   - Click "Reset" to clear all data
   - Adjust settings and run again

## Architecture

### Frontend
- **HTML5**: Semantic structure with responsive layout
- **CSS3**: Dark-mode casino aesthetic with neon accents
- **JavaScript (Vanilla)**: Pure JS with no external frameworks

### Libraries
- **Chart.js**: For line, doughnut, and bar charts
- **Axios**: HTTP client (future: external API integration)

### Data Flow
```
User Config → Simulation Loop → Game Outcome → UI Update → Charts Update
                    ↓
          Cognitive Calculation
                    ↓
          Decision Logging
```

## Project Structure

```
ai-bankroll-gambler/
├── index.html          # HTML structure
├── style.css           # Dark mode styling
├── app.js              # Core simulation logic
└── README.md           # This file
```

## Technical Highlights

### Cognitive Performance Formula
```javascript
Cognition = BankrollPercentage × (1 - LossRatio × 0.3)
```

### Dynamic Risk Calculation
```javascript
BetAmount = BankrollBalance × (BaseStrategy × (1 + CognitiveDegradation × 0.5))
```

### Real-time Chart Updates
- Non-blocking chart updates using `update('none')` for smooth animation
- Efficient data structure with rolling history arrays

## Performance

- **Simulation Speed**: 50 hands in ~15 seconds (300ms per hand)
- **Memory Efficient**: Maintains rolling history of last 20 bets in chart
- **Responsive**: Works smoothly on desktop and tablet

## Future Enhancements

- [ ] True random number generation via Random.org API
- [ ] Multi-player leaderboard comparison
- [ ] Advanced ML prediction of AI failure points
- [ ] Export session data as CSV
- [ ] WebSocket live simulation streaming
- [ ] Machine learning model training on gambling patterns
- [ ] Historical heatmaps of decision-making over time

## Technologies Used

- HTML5
- CSS3 (CSS Grid, Flexbox, Gradients)
- JavaScript (ES6+)
- Chart.js v3
- Axios (for future API integration)

## Browser Support

✅ Chrome/Chromium 90+
✅ Firefox 88+
✅ Safari 14+
✅ Edge 90+

## License

MIT License - Feel free to use, modify, and distribute.

## Author

Created as an exploration of AI decision-making under stress and resource constraints.

---

**Disclaimer**: This is a simulation for educational purposes only. Do not use this as a gambling strategy guide. Real gambling carries financial risk.
