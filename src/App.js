import React from 'react';
import $ from 'jquery';
import './App.css';
const interpolate = require('color-interpolate');

//const colormap = interpolate(['#004', '#090', '#0a0', 'green']);
const colormap = interpolate(['#004', '#0a0', '#0d0', '#0f0', '#6f6']);
const naturalsUpTo = (n) => [...Array(n).keys()];

class Tile extends React.Component {
    render() {
        const isBest = this.props.best !== null && this.props.best[0] == this.props.x && this.props.best[1] == this.props.y;

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
                backgroundColor: this.props.text === null ? colormap(this.props.prob) : (
                    this.props.text === 'HIT' ? '#a2a' : '#44a'
                ),
            }}
            onClick={this.props.onClick}
        >
            {this.props.text === null ? (this.props.prob * 100).toFixed(2) + '%' : this.props.text}
        </div>;
    }
}

class Map extends React.Component {
    constructor() {
        super();
        this.state = this.makeEmptyState();
        this.doComputation(this.state.grid, this.state.squidsGotten);
    }

    makeEmptyState() {
        const grid = [];
        const probs = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                grid[[x, y]] = null;
                probs[[x, y]] = 0.0;
            }
        }
        return {grid, squidsGotten: 'unknown', probs, best: [3, 3], valid: true, observationProb: 1.0};
    }

    doComputation(grid, squidsGotten) {
        const t0 = performance.now();
        const hits = [];
        const misses = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const gridValue = grid[[x, y]];
                if (gridValue === 'HIT')
                    hits.push([x, y]);
                if (gridValue === 'MISS')
                    misses.push([x, y]);
            }
        }
        let squids_gotten = -1;
        for (const n of ['0', '1', '2'])
            if (squidsGotten === n)
                squids_gotten = Number(n);
        $.ajax({
            url: 'http://ec2-34-223-48-61.us-west-2.compute.amazonaws.com:1234/sk',
            type: 'POST',
            data: JSON.stringify({
                hits,
                misses,
                squids_gotten,
            }),
            success: (result) => {
                if (!result.is_possible) {
                    this.setState({valid: false, observationProb: 0});
                    return;
                }
                const t1 = performance.now();
                console.log('Latency: ' + (t1 - t0) + 'ms');
                const probs = {...this.state.probs};
                let y = 0;
                let x = 0;
                for (const row of result.probabilities) {
                    x = 0;
                    for (const entry of row) {
                        probs[[x, y]] = entry;
                        x++;
                    }
                    y++;
                }
                this.setState({probs, best: result.highest_prob, valid: true, observationProb: result.observation_prob});
            },
        });
    }

    onClick(x, y) {
        const grid = {...this.state.grid};
        let gridValue = grid[[x, y]];
        switch (gridValue) {
            case null:
                gridValue = 'MISS';
                break;
            case 'MISS':
                gridValue = 'HIT';
                break;
            case 'HIT':
                gridValue = null;
                break;
        }
        grid[[x, y]] = gridValue;
        this.setState({grid});
        this.doComputation(grid, this.state.squidsGotten);
    }

    clearField() {
        const newState = this.makeEmptyState();
        this.setState(newState);
        this.doComputation(newState.grid, newState.squidsGotten);
    }

    render() {
        let usedShots = 0;
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                if (this.state.grid[[x, y]] !== null)
                    usedShots++;
        return <div style={{
            margin: '20px',
        }}>
            <span style={{fontSize: '150%', color: 'white'}}>Shots used: {usedShots}</span><br/>
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
                        />
                    )}
                </div>
            )}
            {this.state.valid || <div style={{fontSize: '150%', color: 'white'}}>Invalid configuration! This is not possible.</div>}
            <br/>
            <div style={{fontSize: '150%'}}>
                <span style={{color: 'white'}}>Number of squids killed:</span>
                <select
                    style={{marginLeft: '20px', fontSize: '100%'}}
                    value={this.state.squidsGotten}
                    onChange={(event) => {
                        this.setState({squidsGotten: event.target.value});
                        this.doComputation(this.state.grid, event.target.value);
                    }}
                >
                    <option value="unknown">Unknown</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                </select>
                <br/>
                <span style={{color: 'white', fontSize: '80%'}}>
                    Probability of this pattern yielding these results: {(100 * this.state.observationProb).toFixed(2) + '%'}
                </span>
            </div>
            <br/>
            <button style={{fontSize: '150%'}} onClick={() => { this.clearField(); }}>Reset</button>
        </div>;
    }
}

class App extends React.Component {
    componentDidMount() {
        document.body.style.backgroundColor = '#666';
    }

    render() {
        return <div style={{
            textAlign: 'center',
        }}>
            <div style={{display: 'inline-block'}}>
                <div style={{display: 'inline-block', width: '600px'}}>
                    <h1 style={{color: 'white'}}>Sploosh Kaboom Probability Calculator</h1>
                    <p style={{color: 'white'}}>
                        This page gives exact probabilities (no approximation) of hitting a squid in each cell, given the observation of hits, misses, and completed squid kills.
                        Click on the map to cycle a cell between HIT and MISS.
                        You can also set the number of squids completely killed in the drop-down menu at the bottom.
                        You should set this to the value you see in the game for the number of squids killed.
                        This will yield slightly more accurate probabilities.
                        The highest probability location to play will be shown with a yellow outline.
                        If you play perfectly according to picking the highlighted cell you will win in 20 or fewer shots ≈18.5% of the time.
                    </p>
                </div>
                <Map />
                <span style={{color: 'white'}}>Made by Peter Schmidt-Nielsen</span>
            </div>
        </div>;
    }
}

export default App;
