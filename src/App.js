import React from 'react';
import './App.css';
import Collapsible from 'react-collapsible';
import init, {
    set_board_table,
    calculate_probabilities_with_board_constraints,
    calculate_probabilities_from_game_history,
    disambiguate_final_board,
} from './wasm/sploosh_wasm.js';
const interpolate = require('color-interpolate');

const VERSION_STRING = 'v0.0.22';

var globalDB = null;
const indexedDBreq = window.indexedDB.open('splooshkaboom', 1);
indexedDBreq.onerror = function(event) {
    alert('Failed to access IndexedDB.');
};
// Known issue: There's basically a race condition here in that I don't
// wait for this onsuccess to potentially start calling dbRead.
indexedDBreq.onsuccess = function(event) {
    globalDB = event.target.result;
    globalDB.onerror = function(event) {
        alert('IndexedDB error: ' + event.target.errorCode);
    };
};
indexedDBreq.onupgradeneeded = function(event) {
    const db = event.target.result;
    db.createObjectStore('sk');
}

// TODO: Am I using IndexedDB even remotely correctly!? This looks so weird...
// Do I not have to somehow end or commit the transactions!?

function dbWrite(key, value) {
    if (globalDB === null)
        return;

    const transaction = globalDB.transaction(['sk'], 'readwrite');

    transaction.oncomplete = function(event) {
        //alert('Transaction complete!');
    }
    transaction.onerror = function(event) {
        alert('Transaction error!');
    }
    const objectStore = transaction.objectStore('sk');
    const request = objectStore.add(value, key);
    request.onsuccess = function(event) {
        //alert('Request success!');
    }
}

function dbRead(key) {
    return new Promise((resolve, reject) => {
        const transaction = globalDB.transaction(['sk']);

        transaction.oncomplete = function(event) {
            //alert('Transaction complete!');
        }
        transaction.onerror = function(event) {
            alert('Transaction error!');
        }
        const objectStore = transaction.objectStore('sk');
        const request = objectStore.get(key);
        request.onsuccess = function(event) {
            //alert('Request success!');
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            //alert('Request failure!');
            reject();
        };
    });
}

//const colormap = interpolate(['#004', '#090', '#0a0', 'green']);
//const colormap = interpolate(['#004', '#0a0', '#0d0', '#0f0', '#6f6']);
// .        . . . .
// 0123456789abcdef
const colormap = interpolate(['#004', '#070', '#090', '#0b0', '#0d0', '#0f0', '#6f6']);
const naturalsUpTo = (n) => [...Array(n).keys()];

class Tile extends React.Component {
    render() {
        const isBest = this.props.best !== null && this.props.best[0] === this.props.x && this.props.best[1] === this.props.y;

        let backgroundColor = this.props.backgroundColor;
        if (backgroundColor === undefined) {
            backgroundColor = this.props.text === null ? colormap(this.props.prob) : (
                this.props.text === 'HIT' ? '#a2a' : '#44a'
            );
        }

        return <div
            key={this.props.x + ',' + this.props.y}
            style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                width: '70px',
                height: '70px',
                border: this.props.valid ? '1px solid grey' : '1px solid red',
                outline: isBest ? '4px solid yellow' : '',
                zIndex: isBest ? 1 : 0,
                fontFamily: 'monospace',
                userSelect: 'none',
                MozUserSelect: 'none',
                WebkitUserSelect: 'none',
                msUserSelect: 'none',
                color: 'white',
                fontSize: this.props.fontSize,
                opacity: this.props.opacity,
                backgroundColor,
            }}
            onClick={this.props.onClick}
        >
            {this.props.text === null ? (this.props.prob * 100).toFixed(this.props.precision) + '%' : this.props.text}
        </div>;
    }
}

let wasm = init(process.env.PUBLIC_URL + "/sploosh_wasm_bg.wasm");

// Super ugly, please forgive me. :(
var globalMap = null;

async function dbCachedFetch(url, callback) {
    function cacheMiss() {
        const req = new XMLHttpRequest();
        req.open('GET', process.env.PUBLIC_URL + url, true);
        req.responseType = 'arraybuffer';
        req.onload = (evt) => {
            dbWrite(url, req.response);
            callback(req.response);
        };
        req.send();
        return null;
    }
    const result = await dbRead(url).catch(cacheMiss);
    if (result === undefined) {
        cacheMiss();
        return;
    }
    // This is sort of an ugly protocol, but if we hit the catch path above
    // we signal that the callback was already called by returning null.
    if (result === null)
        return;
    callback(result);
}

async function makeBoardIndicesTable() {
    function cacheMiss() {
        const result = actuallyMakeBoardIndicesTable();
        dbWrite('boardIndicesTable', result);
        return result;
    }
    const result = await dbRead('boardIndicesTable').catch(cacheMiss);
    if (result === undefined)
        return cacheMiss();
    return result;
}

function actuallyMakeBoardIndicesTable() {
    // This convention here has to match that in the Rust component and table building C++ exactly!
    const descs = [];
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
            for (const direction of [false, true])
                descs.push({x, y, direction});
    const allBoards = [];
    const boardIndices = {};
    function placeSquid(board, desc, length) {
        for (let i = 0; i < length; i++) {
            let {x, y} = desc;
            if (desc.direction)
                x += i;
            else
                y += i;
            const index = x + 8 * y;
            if (x >= 8 || y >= 8)
                return;
            board[index] = length;
        }
    }
    const board = new Array(64).fill(0);

    for (const squid2 of descs) {
        for (const squid3 of descs) {
            for (const squid4 of descs) {
                board.fill(0);
                placeSquid(board, squid2, 2);
                placeSquid(board, squid3, 3);
                placeSquid(board, squid4, 4);
                let count = 0;
                for (const entry of board)
                    count += entry
                if (count !== 2*2 + 3*3 + 4*4)
                    continue;
                allBoards.push(Array.from(board));
            }
        }
    }
    let index = 0;
    for (const board of allBoards) {
        boardIndices[board.map((i) => i === 0 ? '.' : i).join('')] = index;
        index++;
    }
    return boardIndices;
}

function generateRandomChar() {
    const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const array = new Uint8Array(1);
    while (true) {
        crypto.getRandomValues(array);
        const index = array[0] & 63;
        if (index < base58.length)
            return base58[index];
    }
}

function generateRandomToken(n) {
    let result = '';
    for (let i = 0; i < n; i++)
        result += generateRandomChar();
    return result;
}

// Ugh, maybe later I'll give it a proper domain, and move over to https.
const SPYWARE_HOST = 'http://skphonehome.peter.website:1234';

var globalSpyware = null;
var globalSpywareCounter = -1;

// To anyone reading this:
// I chose the name "spyware" to be silly — this is a completely optional opt-in feature to send usage data for analysis.
// You have to actually explicitly enable the spyware with a checkbox in the GUI, and there's an explanation.
async function sendSpywareEvent(eventData) {
    if (globalSpyware === null || globalMap === null)
        return;
    if (!globalSpyware.state.loggedIn)
        return;
    if (!globalMap.state.spywareMode)
        return;
    eventData.timestamp = (new Date()). getTime() / 1000;
    globalSpywareCounter++;
    //console.log('Sending spyware event:', globalSpywareCounter, eventData);
    const body = JSON.stringify({
        username: globalSpyware.state.username,
        token: globalSpyware.state.token,
        session: globalSpyware.session,
        events: {
            [globalSpywareCounter]: eventData,
        },
    });
    const response = await fetch(SPYWARE_HOST + '/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
    });
    globalSpyware.setState({charsSent: globalSpyware.state.charsSent + body.length});
    if (!response.ok)
        globalSpyware.setState({errors: true});
}

class SpywareModeConfiguration extends React.Component {
    constructor() {
        super();
        globalSpyware = this;
        this.session = generateRandomToken(16);
        let token = localStorage.getItem('SKToken');
        if (token === null) {
            token = generateRandomToken(8);
            localStorage.setItem('SKToken', token);
        }
        let defaultUsername = localStorage.getItem('SKUsername');
        this.state = {
            username: defaultUsername === null ? '' : defaultUsername,
            token,
            loggedIn: false,
            errors: false,
            charsSent: false,
        };
    }

    async onLogin() {
        const username = this.state.username;
        if (username === '') {
            alert('Username must be non-empty');
            return;
        }
        const response = await fetch(SPYWARE_HOST + '/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                'username': username,
                'token': this.state.token,
            }),
        });
        const result = await response.json();
        console.log('Login:', result);
        if (result.success) {
            // Stash the username when we successfully log in, as a convenience for the user.
            localStorage.setItem('SKUsername', username);
            this.setState({loggedIn: true}, () => {
                sendSpywareEvent({
                    kind: 'login',
                    version: VERSION_STRING,
                    bigTable: globalMap === null ? null : globalMap.bigTable,
                });
            });
        } else {
            alert('Bad token! This username might already be taken. If you need to recover your login token contact Peter Schmidt-Nielsen.');
        }
    }

    async onLogout() {
        this.setState({loggedIn: false});
    }

    render() {
        return <div style={{
            fontSize: '120%',
            margin: '10px',
            padding: '10px',
            border: '2px solid white',
            borderRadius: '8px',
            width: '450px',
            display: 'inline-block',
            backgroundColor: this.state.loggedIn ? '#696' : '#777',
        }}>
            <span style={{fontSize: '120%'}}>Spyware Mode:</span>
            <br/>
            {
                this.state.loggedIn ?
                    <>
                        Logged in as: <span style={{fontFamily: 'monospace', fontSize: '150%'}}>{this.state.username}</span>
                        <button style={{marginLeft: '20px'}} onClick={() => this.onLogout()}>Logout</button>
                        <br/>
                        Events sent: {globalSpywareCounter + 1} &nbsp;&nbsp;&nbsp; Chars sent: {this.state.charsSent}
                    </> : <>
                        Username: <input data-stop-shortcuts style={{width: '100px', fontFamily: 'monospace'}} value={this.state.username} onChange={event => this.setState({username: event.target.value})}/>
                        <button style={{marginLeft: '20px'}} onClick={() => this.onLogin()}>Login</button>
                    </>
            }
            <br/>
            <div style={{marginTop: '20px'}}>
                <Collapsible trigger={
                    <div className="clickable" style={{width: '200px', margin: '0px'}}>
                        Access Token
                    </div>
                }>
                    Token: <input data-stop-shortcuts style={{width: '120px', marginRight: '20px'}} value={this.state.token} onChange={event => this.setState({token: event.target.value})}/>
                    <button onClick={() => { localStorage.setItem('SKToken', this.state.token); }}>Update Saved Token</button>
                    <p>
                        The above token is generated just for you.
                        Anyone who has the above token can submit data that will appear on the stats page for your username (so I recommend not showing it on stream).
                        If you lose access to it you'll have to pick a new username, or ask <a href="mailto:schmidtnielsenpeter@gmail.com">Peter Schmidt-Nielsen</a> to help you recover your access token.
                        The token is automatically saved between sessions, but might be lost if you clear all your browser history.
                        I recommend copying this token down somewhere.
                    </p>
                </Collapsible>
            </div>
            {this.state.errors && <span style={{fontSize: '120%', color: 'red'}}>Spyware reporting error!</span>}
        </div>;
    }
}

function sampleSquid(length) {
    const x = Math.round(Math.random() * 8);
    const y = Math.round(Math.random() * 8);
    const direction = Math.random() < 0.5;
    const cells = [[x, y]];
    for (let i = 0; i < length - 1; i++) {
        const cell = cells[cells.length - 1];
        const newXY = direction ? [cell[0] + 1, cell[1]] : [cell[0], cell[1] + 1];
        cells.push(newXY);
    }
    return cells;
}

function generateLayout() {
    const layout = {};
    const hitLocations = {};
    for (const n of [2, 3, 4]) {
        while (true) {
            const candidate = sampleSquid(n);
            let isAdmissible = true;
            for (const cell of candidate)
                if (cell[0] > 7 || cell[1] > 7 || hitLocations[cell] === true)
                    isAdmissible = false;
            if (isAdmissible) {
                layout['squid' + n] = candidate;
                for (const cell of candidate)
                    hitLocations[cell] = true;
                break;
            }
        }
    }
    return layout;
}

class LayoutDrawingBoard extends React.Component {
    constructor() {
        super();
        this.state = { grid: this.makeEmptyGrid(), selectedCell: null };
    }

    makeEmptyGrid() {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = '.';
        return grid;
    }

    clearBoard() {
        this.setState({ grid: this.makeEmptyGrid(), selectedCell: null });
    }

    onClick(x, y) {
        if (this.state.selectedCell === null) {
            this.setState({ selectedCell: [x, y] });
            return;
        }
        const grid = {...this.state.grid};
        let changeMade = false;
        for (const length of [2, 3, 4]) {
            for (const [dx, dy] of [[+1, 0], [0, +1], [-1, 0], [0, -1]]) {
                if (this.state.selectedCell[0] === x + dx * (length - 1) && this.state.selectedCell[1] === y + dy * (length - 1)) {
                    // If this squid appears anywhere else, obliterate it.
                    for (let y = 0; y < 8; y++)
                        for (let x = 0; x < 8; x++)
                            if (grid[[x, y]] === '' + length)
                                grid[[x, y]] = '.';
                    // Fill in the squid here.
                    for (let i = 0; i < length; i++)
                        grid[[x + i * dx, y + i * dy]] = '' + length;
                    changeMade = true;
                }
            }
        }
        // If any squid has the wrong count, then totally eliminate it.
        const countsBySquid = {2: 0, 3: 0, 4: 0, '.': 0};
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                countsBySquid[grid[[x, y]]]++;
        for (const length of [2, 3, 4])
            if (countsBySquid[length] !== length)
                for (let y = 0; y < 8; y++)
                    for (let x = 0; x < 8; x++)
                        if (grid[[x, y]] === '' + length)
                            grid[[x, y]] = '.';
        if (changeMade)
            this.setState({ grid });
        this.setState({ selectedCell: null });
    }

    getLayoutString() {
        // Quadratic time, but who cares?
        let layoutString = '';
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                layoutString += this.state.grid[[x, y]];
        return layoutString;
    }

    setStateFromLayoutString(layoutString) {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = layoutString[x + 8 * y];
        this.setState({grid});
    }

    render() {
        const layoutString = this.getLayoutString();
        let boardIndex = this.props.parent.boardIndices[layoutString];
        if (boardIndex === undefined) {
            boardIndex = "waiting...";
        }
        const isSelectedCell = (x, y) => this.state.selectedCell !== null && x === this.state.selectedCell[0] && y === this.state.selectedCell[1];

        return <div style={{
            margin: '20px',
            display: 'inline-block',
            color: 'white',
        }}>
            <div style={{
                backgroundImage: 'url("' + process.env.PUBLIC_URL + '/board_background_square.png")',
                backgroundSize: '100% 100%',
                padding: '18px',
            }}>
                {naturalsUpTo(8).map(
                    (y) => <div key={y} style={{
                        display: 'flex',
                    }}>
                        {naturalsUpTo(8).map(
                            (x) => <Tile
                                key={x + ',' + y}
                                x={x} y={y}
                                onClick={() => this.onClick(x, y)}
                                text={this.state.grid[[x, y]]}
                                valid={true}
                                best={this.state.selectedCell}
                                fontSize={'200%'}
                                opacity={isSelectedCell(x, y) || this.state.grid[[x, y]] !== '.' ? 0.6 : 0.2}
                                backgroundColor={this.state.grid[[x, y]] === '.' ? undefined : 'green'}
                            />
                        )}
                    </div>
                )}
            </div><br/>
            Squid Layout: {boardIndex}
        </div>;
    }
}

var globalBoardTimer = null;

setInterval(
    () => {
        if (globalBoardTimer !== null)
            globalBoardTimer.forceUpdate();
    },
    69,
);

function renderYesNo(bool) {
    return bool ?
        <span style={{color: 'green', textShadow: '0px 0px 2px white'}}>YES</span> :
        <span style={{color: 'red', textShadow: '0px 0px 2px white'}}>NO</span>;
}

class BoardTimer extends React.Component {
    constructor() {
        super();
        globalBoardTimer = this;
        this.state = {
            previouslyAccumulatedSeconds: 0.0,
            //previouslyAccumulatedRupeeSeconds: 0.0,
            timerStartMS: 0.0,
            timerRunning: false,
            includesLoadingTheRoom: true,
            //rupeesCollected: false,
            includedRewardsGotten: 0,
            invalidated: false,
        };
    }

    toggleRunning() {
        const now = performance.now();
        const elapsed = 1e-3 * (now - this.state.timerStartMS);
        sendSpywareEvent({kind: 'timer_toggleRunning', elapsed, oldState: this.state});
        if (this.state.timerRunning)
            this.setState({previouslyAccumulatedSeconds: this.state.previouslyAccumulatedSeconds + elapsed});
        this.setState({timerRunning: !this.state.timerRunning, timerStartMS: now});
    }

    adjustRewards(delta) {
        sendSpywareEvent({kind: 'timer_adjustRewards', delta, oldState: this.state});
        this.setState({includedRewardsGotten: Math.max(0, Math.min(2, this.state.includedRewardsGotten + delta))});
    }

    toggleLoadingTheRoom() {
        sendSpywareEvent({kind: 'timer_toggleLoadingTheRoom', oldState: this.state});
        this.setState({includesLoadingTheRoom: !this.state.includesLoadingTheRoom});
    }

    toggleInvalidated() {
        sendSpywareEvent({kind: 'timer_toggleInvalidated', oldState: this.state});
        this.setState({invalidated: !this.state.invalidated});
    }

    /*
    toggleRupeesCollected() {
        // TODO: Appropriately perform accumulation, then change the rate.
        this.setState({rupeesCollected: !this.state.rupeesCollected});
    }
    */

    resetTimer() {
        sendSpywareEvent({kind: 'timer_resetTimer', oldState: this.state});
        this.setState({
            previouslyAccumulatedSeconds: 0.0,
            timerStartMS: performance.now(),
            timerRunning: false,
        });
    }

    getSecondsElapsed() {
        let total = this.state.previouslyAccumulatedSeconds;
        if (this.state.timerRunning) {
            const now = performance.now();
            total += 1e-3 * (now - this.state.timerStartMS);
        }
        return total;
    }

    guessStepsElapsedFromTime(timeDeltaSeconds) {
        // I did some linear regressions from real HD Italian runs. I'll put some data up at some point.
        let prediction = Number(this.props.timedTickIntercept) + Number(this.props.timedTickRate) * timeDeltaSeconds;
        if (this.state.includesLoadingTheRoom)
            prediction += -940 + Number(this.props.roomEnteredOffset);
        prediction += this.state.includedRewardsGotten * 760;
        return Math.round(prediction);
    }

    render() {
        const elapsed = this.getSecondsElapsed();
        if (this.state.invalidated)
            return <>
                <span style={{ fontSize: '150%', color: 'white', fontFamily: 'monospace' }}>TIMER</span>
                <span style={{ fontSize: '150%', color: 'white', fontFamily: 'monospace' }}>INVALIDATED</span>
            </>;
        return <>
            <span>&nbsp;Seconds elapsed: </span>
            <span>&nbsp;{elapsed.toFixed(2)}&nbsp;</span>
            <span>&nbsp;Steps:&nbsp;</span>
            <span>&nbsp;{this.guessStepsElapsedFromTime(elapsed)}&nbsp;</span>
            <span>&nbsp;Entered room:</span>
            <span>&nbsp;{renderYesNo(this.state.includesLoadingTheRoom)}&nbsp;</span>
            <span>&nbsp;Rewards gotten:&nbsp;</span>
            <span>&nbsp;{this.state.includedRewardsGotten}&nbsp;</span>
        </>;
            {/* &nbsp;- Rupees collected: {renderYesNo(this.state.rupeesCollected)} */};
    }
}

function computeL1Distance(p1, p2) {
    return Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
}

const defaultConfigurationParams = {
    firstBoardStepsThousands: 500,
    firstBoardStepsThousandsStdDev: 500,
    nextBoardStepsThousands: 7,
    nextBoardStepsThousandsStdDev: 3,
    timedBoardStepsThousandsStdDev: 0.2,
    timedTickIntercept: 156,
    timedTickRate: 252,
    roomEnteredOffset: 0,
};

class MainMap extends React.Component {
    videoRef = React.createRef();
    canvasRef = React.createRef();
    //referenceCanvasRef = React.createRef();
    outputCanvasRef = React.createRef();
    hiddenAreaRef = React.createRef();
    layoutDrawingBoardRefs = [React.createRef(), React.createRef(), React.createRef()];
    timerRef = React.createRef();

    constructor() {
        super();
        this.state = this.makeEmptyState();
        globalMap = this;
        this.previouslyReadStates = [null, null, null];
    }

    componentDidMount() {
        this.doComputation(this.state.grid, this.state.squidsGotten);
    }

    makeEmptyGrid() {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = null;
        return grid;
    }

    makeEmptyState() {
        const probs = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                probs[[x, y]] = 0.0;
        // Select a particular layout, for practice mode.
        const squidLayout = generateLayout();
        const state = {
            mode: 'calculator',
            squidLayout,
            grid: this.makeEmptyGrid(),
            squidsGotten: 'unknown',
            undoBuffer: [],
            probs,
            best: [3, 3],
            cursorBelief: [3, 3],
            valid: true,
            observationProb: 1.0,
            lastComputationTime: -1,

            turboBlurboMode: false,
            turboBlurboTiming: false,
            showKeyShortcuts: false,
            spywareMode: false,

            timerStepEstimate: null,

            potentialMatches: [],
        };
        // Load relevant configuration from localStorage.
        let savedSettings = localStorage.getItem('SKSettings');
        if (savedSettings === null) {
            savedSettings = defaultConfigurationParams;
        } else {
            // if saved configuration from previous version, use defaults for 
            // any new parameters
            savedSettings = JSON.parse(savedSettings);
            for (const name of Object.keys(defaultConfigurationParams)) {
                if (!(name in savedSettings)){
                    savedSettings[name] = defaultConfigurationParams[name];
                }
            }
        }
        const configParams = savedSettings;
        return {...state, ...configParams};
    }

    getConfigParams() {
        const settings = {};
        for (const name of Object.keys(defaultConfigurationParams))
            settings[name] = Number(this.state[name]);
        return settings;
    }

    saveConfigParams() {
        const configParams = this.getConfigParams();
        console.log('Saving config params:', configParams);
        localStorage.setItem('SKSettings', JSON.stringify(configParams));
    }

    factoryResetConfigParams() {
        this.setState(defaultConfigurationParams);
    }

    async initializeTurboBlurboMode(bigTable) {
        if (this.state.turboBlurboMode !== false)
            return;
        this.bigTable = bigTable;
        this.setState({turboBlurboMode: 'initializing'});
        this.boardIndices = await makeBoardIndicesTable();
        this.boardIndexToLayoutString = new Array(Object.keys(this.boardIndices).length);
        for (const key of Object.keys(this.boardIndices))
            this.boardIndexToLayoutString[this.boardIndices[key]] = key;

        const tableName = bigTable ? '/board_table_25M.bin' : '/board_table_5M.bin';
        dbCachedFetch(tableName, (buf) => {
            this.boardTable = new Uint32Array(buf);
            // Warning: Do I need to await wasm here first?
            console.log('Board table length:', this.boardTable.length);
            // Make sure every value is in range.
            for (const v of this.boardTable)
                if (v > 604583)
                    alert('BUG BUG BUG: Bad value in board table: ' + v);
            set_board_table(this.boardTable);
            this.setState({turboBlurboMode: true, squidsGotten: '0', mode: 'calculator'});
        });
    }

    *findMatchingLocations(observedBoards, startIndex, scanRange) {
        if (observedBoards.length === 0) {
            yield [];
            return;
        }
        // Try to find the first match.
        const soughtBoard = observedBoards[0];
        const boardTable = this.boardTable;
        const indexMax = Math.min(boardTable.length, startIndex + scanRange);
        for (let i = startIndex; i < indexMax; i++)
            if (boardTable[i] === soughtBoard)
                for (const subResult of this.findMatchingLocations(observedBoards.slice(1), i, 100000))
                    yield [i, ...subResult];
    }

    recomputePotentialMatches() {
        const [observedBoards, _1, _2] = this.makeGameHistoryArguments();
        const matches = [];
        for (const match of this.findMatchingLocations(observedBoards, 0, 1000000000))
            matches.push(match);
        sendSpywareEvent({kind: 'recomputePotentialMatches', matches});
        if (matches[0].length == 0) {
            matches.length = 0;
            matches.push([null, null]);
        }
        this.setState({potentialMatches: matches});
    }

    makeGameHistoryArguments() {
        // Figure out how many history boards we have.
        const rawObservedBoards = this.layoutDrawingBoardRefs
            .map((ref) => (ref.current ? this.boardIndices[ref.current.getLayoutString()] : undefined));
        const observedBoards = [];
        for (const ob of rawObservedBoards) {
            if (ob === undefined)
                break;
            observedBoards.push(ob);
        }

        // The optimal thing to do here is to save the sequence of step delta estimates, but to make
        // the tool less fragile we only use our timer-based estimates for the very final mean.

        const priorStepsFromPreviousMeans = [];
        const priorStepsFromPreviousStdDevs = [];
        let first = true;
        for (const index of [...observedBoards, null]) {
            if (index === undefined)
                break;
            if (first) {
                priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.firstBoardStepsThousands));
                priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.firstBoardStepsThousandsStdDev));
            } else {
                // If we're the last delta, and also not the first, then possibly use our time delta.
                if (index === null && this.state.timerStepEstimate !== null && this.state.turboBlurboTiming) {
                    // Because the timerStepEstimate can be negative I have to avoid underflow.
                    priorStepsFromPreviousMeans.push(Math.max(0, this.state.timerStepEstimate));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.timedBoardStepsThousandsStdDev));
                } else {
                    priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.nextBoardStepsThousands));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.nextBoardStepsThousandsStdDev));
                }
            }
            first = false;
        }
        return [
            Uint32Array.from(observedBoards),
            Uint32Array.from(priorStepsFromPreviousMeans),
            Float64Array.from(priorStepsFromPreviousStdDevs),
        ];
    }

    getGridStatistics(grid, squidsGotten) {
        const hits = [];
        const misses = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const gridValue = grid[[x, y]];
                if (gridValue === 'HIT')
                    hits.push(8 * y + x);
                if (gridValue === 'MISS')
                    misses.push(8 * y + x);
            }
        }
        let numericSquidsGotten = -1;
        for (const n of ['0', '1', '2', '3'])
            if (squidsGotten === n || squidsGotten === Number(n))
                numericSquidsGotten = Number(n);
        return {hits, misses, numericSquidsGotten};
    }

    async doComputation(grid, squidsGotten) {
        console.log('Doing computation:', squidsGotten, grid);
        const t0 = performance.now();
        const {hits, misses, numericSquidsGotten} = this.getGridStatistics(grid, squidsGotten);
        const hitCount = hits.length;

        await wasm;
        let probabilities;
        let gameHistoryArguments = null;
        if (this.state.turboBlurboMode) {
            gameHistoryArguments = this.makeGameHistoryArguments();
            console.log('gameHistoryArguments:', gameHistoryArguments);

            probabilities = calculate_probabilities_from_game_history(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                numericSquidsGotten,
                ...gameHistoryArguments,
            );
        } else {
            probabilities = calculate_probabilities_with_board_constraints(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                numericSquidsGotten,
                // No constraints for now.
                Uint32Array.from([]),
                Float64Array.from([]),
            );
        }

        let valid = true;
        if (probabilities !== undefined) {
            let maxY = 0;
            let maxX = 0;
            let highestProb = -1;
            let probs = [];

            // Here we implement our L1 distance bonus heuristic.
            // The idea is that we want to highlight a square that isn't too far from where
            // the player last adjusted the board. (i.e. where we believe their cursor is.)
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    probs[[x, y]] = probabilities[8 * y + x];
                    var effectiveProbability =  probabilities[8 * y + x];
                    if (hitCount != 0){
                        const l1Distance = computeL1Distance(this.state.cursorBelief, [x, y]);
                        const distancePenaltyMultiplier = 1 - 0.03 * l1Distance;
                        effectiveProbability = effectiveProbability * distancePenaltyMultiplier
                    }
                    if (grid[[x, y]] === null && effectiveProbability > highestProb) {
                        highestProb = effectiveProbability;
                        maxX = x;
                        maxY = y;
                    }
                }
            }
            const observationProb = probabilities[64];
            this.setState({ probs, best: highestProb >= 0 ? [maxX, maxY] : null, valid, observationProb });
        } else {
            valid = false;
            this.setState({ valid });
        }
        const t1 = performance.now();
        this.setState({lastComputationTime: t1 - t0});
        // Send a really big payload.
        sendSpywareEvent({
            kind: 'doComputation',
            grid, hits, misses, numericSquidsGotten,
            oldValid: this.state.valid,
            didWeConcludeTheSituationWasValid: valid,
            probabilities: probabilities ? Array.from(probabilities) : [],
            turboBlurboMode: this.state.turboBlurboMode,
            turboBlurboTiming: this.state.turboBlurboTiming,
            gameHistoryArguments: (gameHistoryArguments === null) ? [] : gameHistoryArguments.map(a => Array.from(a)),
            timerStepEstimate: this.state.timerStepEstimate,
            computationTime: (t1 - t0) / 1000,
            configParams: this.getConfigParams(),
        });
    }

    copyToUndoBuffer() {
        this.setState({undoBuffer: [
            ...this.state.undoBuffer,
            {grid: this.state.grid, squidsGotten: this.state.squidsGotten, cursorBelief: this.state.cursorBelief},
        ]});
    }

    onClick(x, y, setAsHit) {
        sendSpywareEvent({kind: 'onClick', x, y, setAsHit});
        const grid = { ...this.state.grid };
        let gridValue = grid[[x, y]];
        let squidsGotten = this.state.squidsGotten;
        this.copyToUndoBuffer();

        if (this.state.mode === 'calculator') {
            switch (gridValue) {
                case null:
                    gridValue = setAsHit ? 'HIT' : 'MISS';
                    break;
                case 'MISS':
                    gridValue = 'HIT';
                    break;
                case 'HIT':
                    gridValue = null;
                    break;
            }
            grid[[x, y]] = gridValue;
        } else {
            // Determine from the random layout.
            if (gridValue !== null)
                return;
            const arrayContains = (arr) => {
                for (const cell of arr)
                    if (cell[0] === x && cell[1] === y)
                        return true;
                return false;
            }
            if (arrayContains([...this.state.squidLayout.squid2, ...this.state.squidLayout.squid3, ...this.state.squidLayout.squid4])) {
                gridValue = 'HIT';
            } else {
                gridValue = 'MISS';
            }
            grid[[x, y]] = gridValue;
            // Compute the killed squid count.
            squidsGotten = 0;
            for (const n of ['2', '3', '4']) {
                const squid = this.state.squidLayout['squid' + n];
                let killed = true;
                for (const cell of squid)
                    if (grid[cell] !== 'HIT')
                        killed = false;
                squidsGotten += killed;
            }
            this.setState({ squidsGotten });
        }
        this.setState({grid, cursorBelief: [x, y]});
        this.doComputation(grid, squidsGotten);
    }

    clearField() {
        sendSpywareEvent({kind: 'clearField'});
        const templateState = this.makeEmptyState();
        const newState = {};
        for (const name of ['squidLayout', 'grid', 'squidsGotten', 'undoBuffer', 'cursorBelief'])
            newState[name] = templateState[name];
        // The squidsGotten value of 'unknown' is banned in turbo blurbo mode.
        if (this.state.turboBlurboMode)
            newState.squidsGotten = '0';
        this.setState(newState);
        this.doComputation(newState.grid, newState.squidsGotten);
    }

    undoLastMarking() {
        const undoBuffer = [...this.state.undoBuffer];
        if (undoBuffer.length === 0)
            return;
        const undoEntry = undoBuffer.pop();
        sendSpywareEvent({kind: 'undoLastMarking', undoEntry});
        this.setState({grid: undoEntry.grid, squidsGotten: undoEntry.squidsGotten, cursorBelief: undoEntry.cursorBelief, undoBuffer});
        this.doComputation(undoEntry.grid, undoEntry.squidsGotten);
    }

    reportMiss() {
        if (this.state.best !== null && this.state.grid[this.state.best] === null) {
            sendSpywareEvent({kind: 'reportMiss', best: this.state.best, oldGrid: this.state.grid});
            this.onClick(...this.state.best);
        }
    }

    reportHit() {
        if (this.state.best !== null && this.state.grid[this.state.best] === null) {
            sendSpywareEvent({kind: 'reportHit', best: this.state.best, oldGrid: this.state.grid});
            this.onClick(...this.state.best, true);
            const {hits, misses, numericSquidsGotten} = this.getGridStatistics(this.state.grid, this.state.squidsGotten);
            // This prevents users from having to input the third kill.
            if (hits.length === 9 && numericSquidsGotten === 2) {
                this.incrementKills();
            }
        }
    }

    splitTimer() {
        const boardTimer = this.timerRef.current;
        if (boardTimer === null)
            return;
        const elapsed = boardTimer.getSecondsElapsed();
        const timerStepEstimate = boardTimer.state.invalidated ? null : boardTimer.guessStepsElapsedFromTime(elapsed);
        this.setState({timerStepEstimate});
        console.log('Timer step estimate:', timerStepEstimate);
        sendSpywareEvent({kind: 'splitTimer', invalidated: boardTimer.state.invalidated, timerStepEstimate: timerStepEstimate, elapsed});
        boardTimer.setState({
            previouslyAccumulatedSeconds: 0.0,
            timerStartMS: performance.now(),
            // After the first split we're no longer loading the room.
            includesLoadingTheRoom: false,
            includedRewardsGotten: 0,
            timerRunning: true,
            invalidated: false,
        });
        this.doComputation(this.state.grid, this.state.squidsGotten);
    }

    async incrementKills() {
        this.copyToUndoBuffer();
        let numericValue = this.state.squidsGotten === 'unknown' ? 0 : Number(this.state.squidsGotten);
        let grid = this.state.grid;
        numericValue++;
        if (numericValue === 4) {
            // TODO: Think very carefully about this timer splitting, and if and when it should happen.
            const gameHistoryArguments = this.makeGameHistoryArguments();
            this.splitTimer();
            const success = await this.copyToHistory(gameHistoryArguments);
            if (success) {
                numericValue = 0;
                grid = this.makeEmptyGrid();
                // FIXME: Make us able to undo across completions.
                this.setState({undoBuffer: [], cursorBelief: [3, 3]});
            } else {
                numericValue = 3;
            }
        }
        sendSpywareEvent({kind: 'incrementKills', oldGrid: this.state.grid, newGrid: grid, newNumericValue: numericValue});
        this.setState({grid, squidsGotten: '' + numericValue});
        this.doComputation(grid, '' + numericValue);
    }

    async copyToHistory(gameHistoryArguments) {
        const {hits} = this.getGridStatistics(this.state.grid, this.state.squidsGotten);
        if (gameHistoryArguments === undefined)
            gameHistoryArguments = this.makeGameHistoryArguments();
        await wasm;
        const finalBoard = disambiguate_final_board(
            Uint8Array.from(hits),
            ...gameHistoryArguments,
        );
        if (finalBoard === undefined) {
            // TODO: Show a proper error message in this case!
            //alert('Ambiguous!');
            sendSpywareEvent({
                kind: 'ambiguousCopyToHistory',
                grid: this.state.grid,
                squidsGotten: this.state.squidsGotten,
                gameHistoryArguments: gameHistoryArguments.map(a => Array.from(a)),
            });
            return false;
        }
        console.log('Final board:', finalBoard);
        sendSpywareEvent({kind: 'copyToHistory', squidLayout: finalBoard});
        const layoutString = this.boardIndexToLayoutString[finalBoard];
        const observedBoards = gameHistoryArguments[0];
        let fillIndex = observedBoards.length;
        // If we're already at capacity then we have to shift the boards over.
        if (fillIndex === this.layoutDrawingBoardRefs.length) {
            this.shiftHistory();
            fillIndex--;
        }
        this.layoutDrawingBoardRefs[fillIndex].current.setStateFromLayoutString(layoutString);
        return true;
    }

    shiftHistory() {
        sendSpywareEvent({kind: 'shiftHistory'});
        const drawingBoards = this.layoutDrawingBoardRefs.map((ref) => ref.current);
        for (let i = 0; i < drawingBoards.length -1; i++) {
            drawingBoards[i].setState(drawingBoards[i + 1].state);
        }
        drawingBoards[drawingBoards.length - 1].clearBoard();
    }

    renderActualMap(overlayMode) {
        return <div style={{justifySelf: 'center'}}>
            {naturalsUpTo(8).map(
                (y) => <div key={y} style={{
                    display: 'flex',
                }}>
                    {naturalsUpTo(8).map(
                        (x) => <Tile
                            key={x + ',' + y}
                            x={x} y={y}
                            onClick={() => this.onClick(x, y)}
                            text={this.state.grid[[x, y]]}
                            prob={this.state.probs[[x, y]]}
                            valid={this.state.valid}
                            best={this.state.best}
                            precision={overlayMode ? 0 : 2}
                            opacity={overlayMode ? 0.5 + 0.3 * this.state.probs[[x, y]] : undefined}
                        />
                    )}
                </div>
            )}
        </div>;
    }

    renderOverlayMap() {
        if (!this.state.doVideoProcessing)
            return;
        return <div style={{
            position: 'absolute',
            top: '210px',
            left: '127px',
            transform: 'scale(1.01, 1.05)',
            zIndex: 20,
            display: 'inline-block',
            /* opacity: 0.4, */
        }}>
            {this.renderActualMap(true)}
        </div>;
    }

    render() {
        let usedShots = 0;
        let openingOptimizer = true;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (this.state.grid[[x, y]] !== null) {
                    usedShots++;
                    if (this.state.grid[[x, y]] === 'HIT')
                        openingOptimizer = false;
                }
            }
        }
        return <div style={{
            margin: '20px',
            color: 'white',
        }}>
            <div className="container">
                <div style={{justifySelf: "end", alignSelf: "start"}}>
                    <div className="tableContainer" style={{gridTemplateColumns: "repeat(2, 1fr)"}}>
                        <span><strong>&nbsp;Item&nbsp;</strong></span>
                        <span><strong>&nbsp;Value&nbsp;</strong></span>
                        <span>&nbsp;Shots used:&nbsp;</span>
                        <span>&nbsp;{usedShots}&nbsp;</span>
                        {this.state.turboBlurboMode && this.state.turboBlurboTiming && <>
                            <BoardTimer ref={this.timerRef} roomEnteredOffset={this.state.roomEnteredOffset} timedTickIntercept={this.state.timedTickIntercept} timedTickRate={this.state.timedTickRate}/>
                            <span>&nbsp;Last steps:&nbsp;</span>
                            <span>&nbsp;{this.state.timerStepEstimate === null ? '-' : this.state.timerStepEstimate}&nbsp;</span>
                        </>}
                        {this.state.turboBlurboMode && this.state.turboBlurboTiming && this.state.showKeyShortcuts && <>
                            <span><strong>&nbsp;Control&nbsp;</strong></span><span><strong>&nbsp;Shortcut&nbsp;</strong></span>
                            <span>&nbsp;Toggle Timer&nbsp;</span><span>&nbsp;Space&nbsp;</span>
                            <span>&nbsp;Add Reward&nbsp;</span><span>&nbsp;,&nbsp;</span>
                            <span>&nbsp;Remove Reward&nbsp;</span><span>&nbsp;&lt;&nbsp;</span>
                            <span>&nbsp;Toggle Room Entered&nbsp;</span><span>&nbsp;m&nbsp;</span>
                            <span>&nbsp;Invalidate Timer&nbsp;</span><span>&nbsp;;&nbsp;</span>
                            <span>&nbsp;Reset Timer&nbsp;</span><span>&nbsp;:&nbsp;</span>
                            <span>&nbsp;Split Timer&nbsp;</span><span>&nbsp;s&nbsp;</span>
                        </>}
                    </div>
                    {this.state.turboBlurboMode && this.state.turboBlurboTiming && <>
                        <button style={{ fontSize: '120%', margin: '10px' }} onClick={() => { this.setState({showKeyShortcuts: !this.state.showKeyShortcuts}) }}>Toggle Show Shortcuts</button><br/>
                        <button style={{ fontSize: '120%', margin: '10px' }} onClick={() => { this.setState({spywareMode: !this.state.spywareMode}) }}>{
                            this.state.spywareMode ? <>Disable Spyware Mode</> : <>Enable Spyware Mode</>
                        }</button>
                    </>}
                </div>
                {this.state.doVideoProcessing || this.renderActualMap(false)}
                <span style={{display: "inline-block"}}></span>
            </div>
            {this.state.valid || this.state.turboBlurboMode || <div style={{ fontSize: '150%', color: 'white' }}>Invalid configuration! This is not possible.</div>}
            <br />
            <div style={{ fontSize: '150%' }}>
                <span style={{ color: 'white' }}>Number of squids killed:</span>
                <select
                    style={{ marginLeft: '20px', fontSize: '100%' }}
                    value={this.state.squidsGotten}
                    onChange={(event) => {
                        this.setState({ squidsGotten: event.target.value });
                        this.doComputation(this.state.grid, event.target.value);
                    }}
                >
                    {/* In turbo blurbo mode don't allow unknown, because it's just an accident waiting to happen for a runner. */}
                    {
                        this.state.turboBlurboMode ||
                        <option value="unknown">Unknown</option>
                    }
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                </select>
                <br />
                {/*
                <span style={{color: 'white', fontSize: '80%'}}>
                    Probability of this pattern yielding these results: {(100 * this.state.observationProb).toFixed(2) + '%'}
                </span>
                */}
            </div>
            <br/>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.reportMiss(); }}>Miss (z)</button>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.reportHit(); }}>Hit (x)</button>
            {
                this.state.turboBlurboMode &&
                <>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.copyToHistory(); }}>Copy to History (h)</button>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.shiftHistory(); }}>Shift History</button>
                </>
            }
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.incrementKills(); }}>Increment Kills (c)</button>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.clearField(); }}>Reset</button>
            {
                this.state.turboBlurboMode ||
                <select
                    style={{ marginLeft: '20px', fontSize: '150%' }}
                    value={this.state.mode}
                    onChange={(event) => this.setState({ mode: event.target.value })}
                >
                    <option value="calculator">Calculator Mode</option>
                    <option value="practice">Practice Mode</option>
                </select>
            }
            {
                this.state.turboBlurboMode &&
                <div style={{display: 'inline-block', margin: '10px', border: '1px solid white', borderRadius: '5px', fontSize: '130%', padding: '5px'}}>
                    <span style={{margin: '5px'}}>Timer mode:</span>
                    <input
                        type="checkbox"
                        checked={this.state.turboBlurboTiming}
                        onChange={(event) => this.setState({ turboBlurboTiming: !this.state.turboBlurboTiming })}
                        style={{
                            margin: '10px',
                            transform: 'scale(2)',
                        }}
                    />
                </div>
            }
            <br />
            {openingOptimizer && this.state.mode === 'calculator' && (!this.state.turboBlurboMode) && <>
                <div style={{ color: 'white', fontSize: '120%', marginTop: '20px' }}>
                    Opening optimizer: Probability that this<br />pattern would get at least one hit: {
                        this.state.valid ? ((100 * Math.max(0, 1 - this.state.observationProb)).toFixed(2) + '%') : "Invalid"
                    }
                </div>
            </>}
            <br/>
            {this.state.turboBlurboMode === 'initializing' && <div style={{ fontSize: '150%', color: 'white' }}>Downloading table...<br/></div>}
            {this.state.turboBlurboMode === true && <>
                <div>
                    {this.layoutDrawingBoardRefs.map((ref, i) =>
                        <LayoutDrawingBoard parent={this} ref={ref} key={i}/>
                    )}
                </div>
                <hr/>
                <div style={{display:"grid", gridTemplateColumns: "1fr auto 1fr"}}>
                    <div style={{display:"grid", gridTemplateRows: "1fr 1fr 1fr", gridTemplateColumns: "repeat(8, 1fr)", justifyItems: "center", alignItems: "true", gridColumn: "2"}}>
                        <div style={{gridRow: "1", gridColumn: "1 / span 8"}}>Gaussian RNG step count beliefs (all counts in <i>thousands</i> of steps, except "Room entered offset"):</div>
                        <div style={{gridRow: "2", gridColumn: "1"}}>First board mean:     </div><input style={{width: '60px', fontSize: '120%', gridRow: "2", gridColumn: "2"}} value={this.state.firstBoardStepsThousands}       onChange={event => this.setState({firstBoardStepsThousands: event.target.value})}/>
                        <div style={{gridRow: "2", gridColumn: "3"}}>First board stddev:   </div><input style={{width: '60px', fontSize: '120%', gridRow: "2", gridColumn: "4"}} value={this.state.firstBoardStepsThousandsStdDev} onChange={event => this.setState({firstBoardStepsThousandsStdDev: event.target.value})}/> 
                        <div style={{gridRow: "2", gridColumn: "5"}}>Next board mean:      </div><input style={{width: '60px', fontSize: '120%', gridRow: "2", gridColumn: "6"}} value={this.state.nextBoardStepsThousands}        onChange={event => this.setState({nextBoardStepsThousands: event.target.value})}/>
                        <div style={{gridRow: "2", gridColumn: "7"}}>Next board stddev:    </div><input style={{width: '60px', fontSize: '120%', gridRow: "2", gridColumn: "8"}} value={this.state.nextBoardStepsThousandsStdDev}  onChange={event => this.setState({nextBoardStepsThousandsStdDev: event.target.value})}/>
                        <div style={{gridRow: "3", gridColumn: "1"}}>Timed board stddev:   </div><input style={{width: '60px', fontSize: '120%', gridRow: "3", gridColumn: "2"}} value={this.state.timedBoardStepsThousandsStdDev} onChange={event => this.setState({timedBoardStepsThousandsStdDev: event.target.value})}/>
                        <div style={{gridRow: "3", gridColumn: "3"}}>Timed Tick Intercept: </div><input style={{width: '60px', fontSize: '120%', gridRow: "3", gridColumn: "4"}} value={this.state.timedTickIntercept}             onChange={event => this.setState({timedTickIntercept: event.target.value})}/>
                        <div style={{gridRow: "3", gridColumn: "5"}}>Timed Tick Rate:      </div><input style={{width: '60px', fontSize: '120%', gridRow: "3", gridColumn: "6"}} value={this.state.timedTickRate}                  onChange={event => this.setState({timedTickRate: event.target.value})}/>
                        <div style={{gridRow: "3", gridColumn: "7"}}>Room entered offset:  </div><input style={{width: '60px', fontSize: '120%', gridRow: "3", gridColumn: "8"}} value={this.state.roomEnteredOffset}              onChange={event => this.setState({roomEnteredOffset: event.target.value})}/>
                    </div>
                </div>

                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.saveConfigParams(); }}>Save Settings</button> &nbsp;
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.factoryResetConfigParams(); }}>Reset to Defaults</button>
                <br/>

                <div style={{margin: '20px', color: 'white', fontSize: '130%', border: '2px solid white', borderRadius: '8px', width: '400px', minHeight: '20px', display: 'inline-block'}}>
                    {this.state.potentialMatches.map((match, i) => {
                        if (match[0] === null) {
                            return <div key={0}>No Matches Found!</div>
                        }
                        else {
                            const diffs = match.slice(1);
                            return <div key={i}>
                                Potential match: {match[0]}{diffs.map((x, i) => <> +{x - match[i]}</>)}
                            </div>;
                        }
                    })}
                </div><br/>
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.recomputePotentialMatches(); }}>Find Match Indices</button>
                <div style={{ fontSize: '150%', color: 'white' }}>Turbo blurbo mode initialized.<br/></div>
            </>}
            <button disabled={this.state.turboBlurboMode !== false} style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.initializeTurboBlurboMode(false);
            }}>Initialize Turbo Blurbo Mode</button><br/>
            <button disabled={this.state.turboBlurboMode !== false} style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                this.initializeTurboBlurboMode(true);
            }}>Initialize Turbo Blurbo Mode (big table)</button><br/>

            {this.state.spywareMode && <><SpywareModeConfiguration /><br/></>}

            <span style={{color: 'white'}}>Last recompute time: {this.state.lastComputationTime.toFixed(2)}ms</span>
            <div style={{display: 'none'}} ref={this.hiddenAreaRef}></div>
        </div>;
    }
}

function globalShortcutsHandler(evt) {
    // Check if the target is an input field that should take precedence over shortcuts.
    if (evt.target && 'getAttribute' in evt.target && evt.target.getAttribute('data-stop-shortcuts'))
        return;

    // Add z or y for German keyboard support.
    var event_key = evt.key.toLowerCase();
    if (event_key === 'z' && evt.ctrlKey)
        globalMap.undoLastMarking();
    else if ((event_key === 'z' || event_key === 'y')  && globalMap !== null)
        globalMap.reportMiss();
    if ((event_key === 'x') && globalMap !== null)
        globalMap.reportHit();
    if (event_key === 'c' && globalMap !== null)
        globalMap.incrementKills();
    if (event_key === 's' && globalMap !== null)
        globalMap.splitTimer();
    if (event_key === 'h' && globalMap !== null)
        globalMap.copyToHistory();

    if (event_key === ' ' && globalBoardTimer !== null) {
        globalBoardTimer.toggleRunning();
        evt.preventDefault();
    }
    if (event_key === ',' && globalBoardTimer !== null)
        globalBoardTimer.adjustRewards(+1);
    if (event_key === '<' && globalBoardTimer !== null)
        globalBoardTimer.adjustRewards(-1);
    if (event_key === 'm' && globalBoardTimer !== null)
        globalBoardTimer.toggleLoadingTheRoom();
    if (event_key === ';' && globalBoardTimer !== null)
        globalBoardTimer.toggleInvalidated();
    if (event_key === ':' && globalBoardTimer !== null)
        globalBoardTimer.resetTimer();
}

document.addEventListener('keydown', globalShortcutsHandler);

class App extends React.Component {
    componentDidMount() {
        document.body.style.backgroundColor = '#666';
    }

    render() {
        return <div style={{
            textAlign: 'center',
        }}>
            <div style={{ display: 'inline-block', width: '600px' }}>
                <h1 style={{ color: 'white' }}>Sploosh Kaboom Probability Calculator</h1>
                <p style={{ color: 'white' }}>
                    This is a tool for computing the likely locations of squids in the sploosh kaboom minigame of The Legend of Zelda: The Wind Waker (both SD and HD versions).
                    Unfortunately it's currently pretty complicated to use correctly.
                    A collection of tutorials will be compiled at some point, hopefully soon.
                    For now, see the <a href="https://github.com/petersn/web-sploosh-kaboom">GitHub repository</a>.
                </p>
            </div>
            <MainMap />
            <span style={{ color: 'white' }}>Made by Peter Schmidt-Nielsen, CryZe, and csunday95 ({VERSION_STRING})</span><br/>
            <span style={{ color: 'white' }}></span>
        </div>;
    }
}

export default App;
