// Game State
const gameState = {
    bankroll: 10000,
    tableStack: 0,
    currentBet: 0,
    handsPlayed: 0,
    totalProfit: 0,
    sessionProfit: 0,
    variance: 0,
    inHand: false,
    yourHand: [],
    communityCards: [],
    pot: 0,
    aiPlayers: [
        { name: 'Villain 1', stack: 0, hand: [], folded: false, bet: 0 },
        { name: 'Villain 2', stack: 0, hand: [], folded: false, bet: 0 }
    ],
    handWinner: null
};

const STAKES = {
    micro: { bb: 2, buyin: 200 },
    low: { bb: 10, buyin: 1000 },
    mid: { bb: 50, buyin: 5000 },
    high: { bb: 200, buyin: 20000 }
};

const CARDS = ['2♠', '3♠', '4♠', '5♠', '6♠', '7♠', '8♠', '9♠', '10♠', 'J♠', 'Q♠', 'K♠', 'A♠',
               '2♥', '3♥', '4♥', '5♥', '6♥', '7♥', '8♥', '9♥', '10♥', 'J♥', 'Q♥', 'K♥', 'A♥',
               '2♦', '3♦', '4♦', '5♦', '6♦', '7♦', '8♦', '9♦', '10♦', 'J♦', 'Q♦', 'K♦', 'A♦',
               '2♣', '3♣', '4♣', '5♣', '6♣', '7♣', '8♣', '9♣', '10♣', 'J♣', 'Q♣', 'K♣', 'A♣'];

// DOM Elements
const bankrollDisplay = document.getElementById('bankroll');
const buyinBtn = document.getElementById('buyinBtn');
const foldBtn = document.getElementById('foldBtn');
const checkBtn = document.getElementById('checkBtn');
const callBtn = document.getElementById('callBtn');
const raiseBtn = document.getElementById('raiseBtn');
const allInBtn = document.getElementById('allInBtn');
const resetBtn = document.getElementById('resetBtn');
const actionLog = document.getElementById('actionLog');
const buyinInput = document.getElementById('buyinAmount');
const stakeSelect = document.getElementById('stakeLevel');
const potDisplay = document.getElementById('potAmount');
const handsDisplay = document.getElementById('handsPlayed');
const winRateDisplay = document.getElementById('winRate');
const varianceDisplay = document.getElementById('variance');
const roiDisplay = document.getElementById('roi');
const riskBar = document.getElementById('riskBar');
const riskText = document.getElementById('riskText');
const yourCardsDisplay = document.getElementById('yourCards');
const aiCards1Display = document.getElementById('aiCards1');
const aiCards2Display = document.getElementById('aiCards2');
const communityCardsDisplay = document.getElementById('communityCardsDisplay');
const raiseModal = document.getElementById('raiseModal');
const raiseAmountInput = document.getElementById('raiseAmount');
const confirmRaiseBtn = document.getElementById('confirmRaise');
const cancelRaiseBtn = document.getElementById('cancelRaise');
const callAmountDisplay = document.getElementById('callAmount');

// Utility Functions
function updateUI() {
    bankrollDisplay.textContent = gameState.bankroll.toLocaleString();
    potDisplay.textContent = gameState.pot.toLocaleString();
    handsDisplay.textContent = gameState.handsPlayed;
    updateRiskMeter();
    updateStats();
}

function updateRiskMeter() {
    const bb = STAKES[stakeSelect.value].bb;
    const riskPercent = (bb / gameState.bankroll) * 100;
    riskBar.style.width = Math.min(riskPercent, 100) + '%';
    
    if (riskPercent < 5) {
        riskText.textContent = '✓ Safe';
        riskText.style.color = 'var(--primary)';
    } else if (riskPercent < 10) {
        riskText.textContent = '⚠ Moderate';
        riskText.style.color = 'var(--gold)';
    } else {
        riskText.textContent = '⚠ High Risk';
        riskText.style.color = 'var(--danger)';
    }
}

function updateStats() {
    if (gameState.handsPlayed > 0) {
        const winRate = (gameState.sessionProfit / gameState.handsPlayed).toFixed(2);
        winRateDisplay.textContent = winRate;
        varianceDisplay.textContent = Math.abs(gameState.variance).toFixed(1);
        const roi = gameState.tableStack > 0 ? ((gameState.sessionProfit / gameState.tableStack) * 100).toFixed(1) : '0';
        roiDisplay.textContent = roi + '%';
    }
}

function addLog(message, type = '') {
    const entry = document.createElement('p');
    entry.className = 'log-entry ' + type;
    entry.textContent = message;
    actionLog.insertBefore(entry, actionLog.firstChild);
    if (actionLog.children.length > 20) actionLog.removeChild(actionLog.lastChild);
}

function dealCards() {
    const dealt = [];
    const hand = [];
    while (hand.length < 2) {
        const card = CARDS[Math.floor(Math.random() * CARDS.length)];
        if (!dealt.includes(card)) {
            hand.push(card);
            dealt.push(card);
        }
    }
    return hand;
}

function getRandomCards(count, exclude = []) {
    const available = CARDS.filter(card => !exclude.includes(card));
    const cards = [];
    while (cards.length < count) {
        const card = available[Math.floor(Math.random() * available.length)];
        if (!cards.includes(card)) {
            cards.push(card);
        }
    }
    return cards;
}

function startHand() {
    if (gameState.bankroll < STAKES[stakeSelect.value].bb) {
        addLog('Insufficient bankroll. Buy in first!', 'lose');
        return;
    }

    gameState.inHand = true;
    gameState.pot = 0;
    gameState.currentBet = 0;
    gameState.handsPlayed++;
    gameState.yourHand = dealCards();
    gameState.communityCards = [];
    gameState.aiPlayers.forEach(ai => {
        ai.hand = dealCards();
        ai.folded = false;
        ai.bet = 0;
        ai.stack = gameState.bankroll * (Math.random() * 0.5 + 0.5);
    });
    gameState.tableStack = parseInt(buyinInput.value) || 100;
    gameState.bankroll -= gameState.tableStack;
    gameState.pot = gameState.tableStack;

    displayCards();
    updateUI();
    addLog(`Hand #${gameState.handsPlayed} started. You have: ${gameState.yourHand.join(' ')}`, 'action');
    
    // Flop
    setTimeout(() => {
        gameState.communityCards = getRandomCards(3, [...gameState.yourHand, ...gameState.aiPlayers.flatMap(a => a.hand)]);
        displayCards();
        addLog(`Flop: ${gameState.communityCards.join(' ')}`, 'action');
        aiAction();
    }, 1500);
}

function displayCards() {
    yourCardsDisplay.innerHTML = gameState.yourHand.map(card => `<div class="card">${card}</div>`).join('');
    
    if (gameState.inHand) {
        aiCards1Display.innerHTML = gameState.aiPlayers[0].folded ? '<div class="card">X</div>' : gameState.aiPlayers[0].hand.map(card => `<div class="card">?</div>`).join('');
        aiCards2Display.innerHTML = gameState.aiPlayers[1].folded ? '<div class="card">X</div>' : gameState.aiPlayers[1].hand.map(card => `<div class="card">?</div>`).join('');
    }
    
    if (gameState.communityCards.length > 0) {
        communityCardsDisplay.innerHTML = gameState.communityCards.map(card => `<div class="card">${card}</div>`).join('');
    }
}

function aiAction() {
    gameState.aiPlayers.forEach((ai, idx) => {
        if (ai.folded) return;
        
        const foldChance = Math.random();
        const raiseChance = Math.random();
        
        if (foldChance < 0.3) {
            ai.folded = true;
            addLog(`${ai.name} folds.`);
        } else if (raiseChance < 0.2) {
            const raise = Math.floor(Math.random() * ai.stack * 0.3);
            ai.bet += raise;
            gameState.pot += raise;
            addLog(`${ai.name} raises $${raise}.`);
        } else {
            const call = Math.min(gameState.currentBet - ai.bet, ai.stack);
            ai.bet += call;
            gameState.pot += call;
            addLog(`${ai.name} calls $${call}.`);
        }
    });
    
    enablePlayerActions();
    updateUI();
}

function endHand(yourWon) {
    gameState.inHand = false;
    disablePlayerActions();
    
    const result = yourWon ? gameState.pot : -gameState.tableStack;
    gameState.sessionProfit += result;
    gameState.bankroll += gameState.pot;
    gameState.variance += Math.abs(result);
    
    if (yourWon) {
        addLog(`You won the hand! +$${gameState.pot}`, 'win');
        displayCards();
    } else {
        addLog(`You lost the hand. -$${gameState.tableStack}`, 'lose');
    }
    
    updateUI();
}

function enablePlayerActions() {
    foldBtn.disabled = false;
    checkBtn.disabled = false;
    callBtn.disabled = false;
    raiseBtn.disabled = false;
    allInBtn.disabled = false;
}

function disablePlayerActions() {
    foldBtn.disabled = true;
    checkBtn.disabled = true;
    callBtn.disabled = true;
    raiseBtn.disabled = true;
    allInBtn.disabled = true;
}

// Event Listeners
buyinBtn.addEventListener('click', () => {
    const buyin = parseInt(buyinInput.value);
    if (buyin > gameState.bankroll) {
        addLog('Insufficient bankroll!', 'lose');
        return;
    }
    if (gameState.inHand) return;
    buyinBtn.textContent = 'Betting...';
    buyinBtn.disabled = true;
    setTimeout(() => {
        startHand();
        buyinBtn.textContent = 'Buy In';
        buyinBtn.disabled = false;
    }, 1000);
});

foldBtn.addEventListener('click', () => {
    addLog('You folded.', 'lose');
    endHand(false);
});

checkBtn.addEventListener('click', () => {
    addLog('You checked.');
    gameState.currentBet = 0;
    aiAction();
});

callBtn.addEventListener('click', () => {
    const callAmount = Math.min(gameState.currentBet, gameState.bankroll);
    gameState.bankroll -= callAmount;
    gameState.pot += callAmount;
    addLog(`You called $${callAmount}.`);
    
    if (Math.random() < 0.6) {
        endHand(true);
    } else {
        aiAction();
    }
});

raiseBtn.addEventListener('click', () => {
    raiseModal.classList.remove('hidden');
});

allInBtn.addEventListener('click', () => {
    gameState.pot += gameState.bankroll;
    addLog(`You went all in! $${gameState.bankroll}`);
    gameState.bankroll = 0;
    
    if (Math.random() < 0.55) {
        endHand(true);
    } else {
        endHand(false);
    }
});

confirmRaiseBtn.addEventListener('click', () => {
    const raise = parseInt(raiseAmountInput.value);
    if (isNaN(raise) || raise < STAKES[stakeSelect.value].bb) {
        addLog('Raise must be at least the big blind.', 'lose');
        return;
    }
    if (raise > gameState.bankroll) {
        addLog('Insufficient chips.', 'lose');
        return;
    }
    
    gameState.bankroll -= raise;
    gameState.pot += raise;
    gameState.currentBet = raise;
    addLog(`You raised to $${raise}.`);
    raiseModal.classList.add('hidden');
    raiseAmountInput.value = '';
    aiAction();
});

cancelRaiseBtn.addEventListener('click', () => {
    raiseModal.classList.add('hidden');
    raiseAmountInput.value = '';
});

resetBtn.addEventListener('click', () => {
    gameState.bankroll = 10000;
    gameState.handsPlayed = 0;
    gameState.sessionProfit = 0;
    gameState.variance = 0;
    gameState.inHand = false;
    gameState.pot = 0;
    actionLog.innerHTML = '<p class="log-entry">Game reset. Welcome back!</p>';
    disablePlayerActions();
    updateUI();
    displayCards();
});

stakeSelect.addEventListener('change', () => {
    updateRiskMeter();
});

// Initial UI update
updateUI();
disablePlayerActions();
addLog('Welcome! Set your stake and buy in to start playing.');
addLog('Manage your bankroll wisely. Good luck!');