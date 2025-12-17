# Order Flow Audio Monitor

A TickStrike-style order flow audio visualization tool with professional VU meters.

## Features

- ✅ **Stereo Audio**: Left ear = SELL/BID, Right ear = BUY/ASK
- ✅ **VU Meters**: Professional audio-style level meters with green/yellow/red zones
- ✅ **Rapid-Fire Clicks**: Authentic stacking effect for high-frequency trading
- ✅ **Real-time Statistics**: Track buy/sell counts, volume, events per second
- ✅ **Configurable**: Adjust frequency, volume, speed, sensitivity
- ✅ **Sample Data Playback**: Test with CSV files before connecting to live data

## Quick Start

### 1. Install Dependencies

```bash
cd orderflow-audio
npm install
```

### 2. Run the Application

```bash
npm start
```

### 3. Load Sample Data

1. Click "Load Sample Data"
2. Select `sample-data.csv`
3. Click ▶ Play

That's it! You should hear stereo audio clicks and see the VU meters responding.

## Exporting Data from Sierra Chart

### Method 1: Time & Sales Export

1. In Sierra Chart, go to **Tools → Export Intraday Data**
2. Select **Time and Sales**
3. Choose date range
4. Export format: **CSV**
5. Make sure to include: Time, Price, Volume, and Bid/Ask flag

### Method 2: Custom Study Export

Create a study that logs trades to a file with this format:

```cpp
// In your ACSIL study
if (sc.GetBarHasClosedStatus() == BHCS_BAR_HAS_CLOSED) {
    FILE* fp = fopen("C:\\trades.csv", "a");
    fprintf(fp, "%lld,%.2f,%d,%s\n", 
        sc.BaseDateTimeIn[sc.Index].GetAsUnixTime() * 1000,
        sc.Close[sc.Index],
        sc.Volume[sc.Index],
        sc.Volume[sc.Index] > 0 ? "ASK" : "BID"
    );
    fclose(fp);
}
```

### Method 3: Record DTC Stream (Advanced)

Save this as `record-dtc.js`:

```javascript
const net = require('net');
const fs = require('fs');

const client = net.createConnection({ 
    host: 'localhost', 
    port: 11099 
});

const output = fs.createWriteStream('dtc-recording.bin');

client.on('data', (data) => {
    output.write(data);
    console.log(`Recorded ${data.length} bytes`);
});

process.on('SIGINT', () => {
    console.log('Recording stopped');
    output.end();
    client.end();
    process.exit();
});

console.log('Recording DTC stream... Press Ctrl+C to stop');
```

Run: `node record-dtc.js`

## CSV Format

Your CSV file should have this format:

```csv
timestamp,price,volume,side
1703001600000,25293.25,10,BID
1703001600050,25293.50,15,ASK
1703001600100,25293.25,8,BID
```

**Fields:**
- `timestamp`: Unix timestamp in milliseconds
- `price`: Trade price
- `volume`: Trade volume (contracts/shares)
- `side`: "BID" (selling) or "ASK" (buying)

## Controls

### Playback Controls
- **Play** (Space): Start/resume playback
- **Pause** (Space): Pause playback
- **Stop** (Esc): Stop and reset to beginning

### Audio Settings
- **Frequency**: Tone pitch (1000-5000 Hz, default 3380 Hz)
- **Master Volume**: Overall audio level (0-100%)
- **Playback Speed**: How fast to replay data (0.1x - 5x)
- **Sensitivity**: How responsive the VU meters are (0-100%)

## Understanding the VU Meters

The VU meters work like professional audio equipment:

- **🟢 GREEN ZONE** (bottom 60%): Normal activity
- **🟡 YELLOW ZONE** (middle 25%): Elevated activity
- **🔴 RED ZONE** (top 15%): Peak activity

**Peak Indicators** (white bars): Show the highest recent level

**Left Meter**: SELL/BID pressure (audio in left ear)
**Right Meter**: BUY/ASK pressure (audio in right ear)

## Tips for Best Results

### Audio Settings
1. **Start with default frequency (3380 Hz)** - This is similar to TickStrike
2. **Adjust volume to 20-40%** - Prevents ear fatigue
3. **Use headphones** - Stereo separation is critical
4. **Lower sensitivity for high-frequency data** - Prevents meter overload

### Data Collection
1. **Record during active market hours** - Better test data
2. **Include both quiet and volatile periods** - See full range
3. **5-10 minutes is ideal** - Long enough to test, not overwhelming
4. **Multiple sessions** - Different market conditions

### Rapid-Fire Effect
To hear the "click stacking" effect you mentioned:
1. Use data from high-frequency periods (opening bell, news events)
2. Increase playback speed (2-3x)
3. You'll hear multiple clicks overlapping - this is the authentic effect

## Next Steps: Connecting to Live Data

Once you're happy with the UI and audio, the next phase is connecting to Sierra Chart's DTC feed.

### Architecture:
```
Sierra Chart (DTC Server)
    ↓
Node.js Backend (dtc-client.js)
    ↓
WebSocket → Electron Frontend
    ↓
Audio Engine + VU Meters
```

### Files to Create:
1. `dtc-client.js` - DTC protocol parser
2. `websocket-server.js` - Bridge between DTC and frontend
3. Update `data-player.js` to accept live WebSocket data

### Estimated Timeline:
- **Week 1**: Get UI/audio perfect with sample data (you are here)
- **Week 2**: Build DTC client and WebSocket bridge
- **Week 3**: Integrate live data, test, polish
- **Week 4**: Add features (multiple instruments, alerts, etc.)

## Troubleshooting

### No Audio Playing
- Make sure you clicked Play (audio requires user interaction)
- Check your system volume and audio output device
- Try refreshing the app

### Meters Not Moving
- Check that your CSV has the correct format
- Make sure volume column has reasonable values (1-1000 typical)
- Try increasing sensitivity

### Audio Clicks Too Loud/Soft
- Adjust Master Volume slider
- Check your system audio settings
- Consider adjusting frequency (higher = more piercing)

### Playback Too Fast/Slow
- Adjust Playback Speed slider
- Remember: 1.0x = real-time based on timestamps
- 2.0x = twice as fast, 0.5x = half speed

## File Structure

```
orderflow-audio/
├── main.js              # Electron main process
├── index.html           # UI layout and styling
├── app.js              # Main application logic
├── audio-engine.js     # Web Audio API wrapper
├── vu-meter.js         # VU meter visualization
├── data-player.js      # CSV playback engine
├── sample-data.csv     # Example data file
└── package.json        # NPM dependencies
```

## Technical Details

### Audio Synthesis
- Uses Web Audio API's OscillatorNode for tone generation
- StereoPannerNode for left/right positioning (-1.0 to +1.0)
- GainNode for volume control with envelope shaping
- ~3380 Hz frequency (optimal human hearing range)
- 75ms duration per click (configurable)

### VU Meter Animation
- 60 FPS smooth animation using requestAnimationFrame
- Logarithmic decay for natural fall-off
- Peak hold with delayed decay
- Responsive to both large and small volume changes

### Data Playback
- Timestamp-based playback (maintains original timing)
- Speed multiplier preserves relative timing
- Efficient scheduling using setTimeout
- Statistics tracking in real-time

## Future Enhancements

Potential additions once live data is working:

- [ ] Multiple instrument support (ES, NQ, GC simultaneously)
- [ ] Volume-weighted alerts (trigger on X contracts)
- [ ] Correlation analysis (multiple instruments)
- [ ] Session recording/replay
- [ ] Custom audio profiles (different sounds per instrument)
- [ ] Integration with trading platforms (position awareness)
- [ ] Historical pattern recognition
- [ ] Alert rules engine

## Credits

Inspired by TickStrike's order flow audio visualization approach.

Built with:
- Electron
- Web Audio API
- Pure JavaScript (no frameworks)

## Support

For questions about:
- **Sierra Chart**: See Sierra Chart forums
- **DTC Protocol**: Visit https://dtcprotocol.org
- **This App**: Check the code comments or create an issue

---

**Ready to build a TickStrike clone?**

This is your foundation. The hard parts (audio synthesis, stereo positioning, VU meters) are done. Now you can focus on perfecting the UI and then connecting to live data.

**Next:** Export some real tick data from Sierra Chart and load it in!