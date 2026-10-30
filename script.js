// finds an HTML element using its ID
const $ = (id) => document.getElementById(id);

// stores all the information about the aircraft and simulator
const state = {
    power: false,
    engine: false,
    throttle: 0,
    altitudeControl: 0,
    altitude: 0,
    mode: 'GROUND',
    error: false,
    message: 'Welcome to the raw verion of something. Switch POWER on to begin the simulation!',
    audioEnabled: false,
    landingPlayed: false
};

// stores the objects used to create and control sounds
let audioContext = null;
let oscillator = null;
let gainNode = null;
let engineStartedAt = 0;

// finds the OLED screen and prepares it for drawing
const oled = $('oled');
const ctx = oled.getContext('2d');

// MESSAGES !!!

// changes the message and shows if there is an error
function setMessage(text, error = false) {
    state.message = text;
    state.error = error;
    render();
}

// AUDIO !!!

/* For the audio part of simulation, I used the Web Audio API, which is built into JavaScript and works directly in the browser. I used AudioContext to manage the sound, Oscillator to generate it, and GainNode to control the volume. Instead of using recorded sounds like the original KT148A chip, my simulation generates sounds in real time. For example, when the throttle increases, the frequency and volume change to imitate the sound of an aircraft engine. This way, the audio responds directly to the inputs without needing any external sound files or libraries */

// prepares the browser audio system if sound is enabled
function ensureAudio() {
    if (!state.audioEnabled) return null;

    try {
        if (!audioContext) {
            const AudioClass =
                window.AudioContext || window.webkitAudioContext;

            audioContext = new AudioClass();
        }

        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        return audioContext;
    } catch {
        return null;
    }
}

// creates a short sound with the selected frequency and volume - taken from the library's documentation
function tone(frequency = 440, duration = 0.15, volume = 0.08, type = 'sine') {
    const ac = ensureAudio();

    if (!ac) return;

    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = type;
    osc.frequency.value = frequency;

    setToneVolume(ac, gain, volume, duration);

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start();
    osc.stop(ac.currentTime + duration + 0.02);
}

// makes a short sound fade in and out smoothly - same, documentation
function setToneVolume(ac, gain, volume, duration) {
    const now = ac.currentTime;

    gain.gain.setValueAtTime(0.0001, now);

    gain.gain.exponentialRampToValueAtTime(
        volume,
        now + 0.015
    );

    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + duration
    );
}

// creates the continuous sound of the aircraft engine
function engineAudioStart() {
    const ac = ensureAudio();

    if (!ac || oscillator) return;

    oscillator = ac.createOscillator();
    gainNode = ac.createGain();

    oscillator.type = 'sawtooth';
    gainNode.gain.value = 0.015;

    oscillator.connect(gainNode);
    gainNode.connect(ac.destination);

    oscillator.start();

    updateEngineAudio();
}

// changes the engine sound depending on the throttle position
function updateEngineAudio() {
    if (!oscillator || !audioContext) return;

    const frequency = 50 + state.throttle * 2;
    const volume = 0.008 + state.throttle * 0.00016;
    const now = audioContext.currentTime;

    oscillator.frequency.setTargetAtTime(
        frequency,
        now,
        0.12
    );

    gainNode.gain.setTargetAtTime(
        volume,
        now,
        0.12
    );
}

// stops the engine sound and disconnects its audio parts
function engineAudioStop() {
    if (!oscillator) return;

    try {
        oscillator.stop();
        oscillator.disconnect();
        gainNode.disconnect();
    } catch {
        // ignores errors if the sound has already stopped
    }

    oscillator = null;
    gainNode = null;
}

// plays four sounds with lower frequencies to imitate landing
function landingSound() {
    const frequencies = [480, 400, 330, 250];

    frequencies.forEach((frequency, index) => {
        setTimeout(() => {
            tone(frequency, 0.24, 0.07, 'triangle');
        }, index * 230);
    });
}

// turns sound on or off when the audio button is pressed
function toggleAudio() {
    state.audioEnabled = !state.audioEnabled;

    if (state.audioEnabled) {
        ensureAudio();

        if (state.engine) {
            engineAudioStart();
        } else {
            tone(660, 0.12);
        }
    } else {
        engineAudioStop();
    }

    render();
}

// POWER

// changes the main power switch and updates the simulator
function setPower(on) {
    state.power = on;

    if (on) {
        powerOn();
    } else {
        powerOff();
    }

    render();
}

// turns on the simulator and plays a short sound
function powerOn() {
    state.message = 'Power on. Good job! Engine next.';

    tone(620, 0.13);
}

// turns off the simulator and resets the engine and altitude
function powerOff() {
    state.engine = false;
    state.altitude = 0;
    state.error = false;
    state.landingPlayed = false;

    $('engine').checked = false;

    engineAudioStop();

    state.message = 'Power disconnected. All systems off. Pray you are on the ground now.';
}

// ENGINE

// checks if the engine is allowed to start or stop
function canChangeEngine(on) {
    if (on && !state.power) {
        $('engine').checked = false;

        setMessage(
            'You might need power, my friend.',
            true
        );

        tone(200, 0.25);
        return false;
    }

    if (on && state.mode === 'LAND') {
        $('engine').checked = false;

        setMessage(
            'You are LANDING!!! Select GROUND.',
            true
        );

        return false;
    }

    if (
        !on &&
        state.engine &&
        state.mode === 'FLIGHT' &&
        state.altitude > 0
    ) {
        $('engine').checked = true;

        setMessage(
            'Engine shutdown blocked while flying. GUESS WHY!',
            true
        );

        tone(220, 0.2);
        return false;
    }

    return true;
}

// changes the engine state after checking if the action is allowed
function setEngine(on) {
    if (!canChangeEngine(on)) return;

    state.engine = on;
    state.error = false;

    if (on) {
        startEngine();
    } else {
        stopEngine();
    }

    render();
}

// starts the engine and plays its startup sound
function startEngine() {
    engineStartedAt = performance.now();

    state.message =
        'Engine starting. Adjust throttle to increase RPM!';

    tone(280, 0.24);
    engineAudioStart();
}

// stops the engine and plays its shutdown sound
function stopEngine() {
    engineAudioStop();

    state.message = 'Engine stopped. I hope you are not flying.....';

    tone(180, 0.3);
}

// FLIGHT MODES

// changes the flight mode and updates the message
function setMode(mode) {
    state.mode = mode;
    state.error = false;
    state.landingPlayed = false;

    updateModeMessage();

    render();
}

// shows the correct message for the selected flight mode
function updateModeMessage() {
    if (!state.power) {
        state.message =
            'Select POWER to activate the simulator :)';
        return;
    }

    if (state.mode === 'FLIGHT' && !state.engine) {
        state.message =
            'FLIGHT selected: start the engine first.';

        state.error = true;
        return;
    }

    if (state.mode === 'FLIGHT') {
        state.message =
            'FLIGHT selected. Adjust throttle and altitude control.';
        return;
    }

    if (state.mode === 'LAND') {
        state.message =
            'LAND selected. Reduce throttle and altitude to land.';
        return;
    }

    state.message = 'GROUND selected.';
}

// FLIGHT SIMULATION

// updates the aircraft position and checks landing and engine startup
function updateFlight(dt) {
    if (!state.power) return;

    moveAltitude(dt);
    checkLanding();
    checkEngineStartup();
}

// calculates the altitude the aircraft should try to reach
function getTargetAltitude() {
    if (
        state.engine &&
        state.mode === 'FLIGHT' &&
        state.throttle >= 20
    ) {
        return state.altitudeControl * 100;
    }

    return 0;
}

// calculates how fast the aircraft can change altitude
function getAltitudeRate(dt) {
    const speed = state.mode === 'LAND' ? 2500 : 1200;

    return speed * dt;
}

// moves the aircraft toward the selected altitude
function moveAltitude(dt) {
    const target = getTargetAltitude();
    const rate = getAltitudeRate(dt);

    const difference = target - state.altitude;

    const movement = Math.sign(difference) *
        Math.min(Math.abs(difference), rate);

    state.altitude += movement;
}

// checks if the aircraft has landed and plays the landing sound
function checkLanding() {
    if (
        state.mode === 'LAND' &&
        state.altitude <= 1 &&
        state.engine &&
        !state.landingPlayed
    ) {
        state.altitude = 0;
        state.landingPlayed = true;

        state.message =
            'Landing complete!';

        landingSound();
    }
}

// changes the engine message after the startup time has passed
function checkEngineStartup() {
    if (!state.engine) return;

    const elapsed = performance.now() - engineStartedAt;

    if (
        elapsed > 1100 &&
        state.message.startsWith('Engine starting')
    ) {
        state.message = 'Engine running.';
    }
}

// LED SCREEN

// clears the OLED screen and sets its drawing colors
function prepareOLED() {
    ctx.fillStyle = '#001b1b';
    ctx.fillRect(0, 0, 512, 256);

    ctx.fillStyle = '#8cfbe5';
    ctx.strokeStyle = '#8cfbe5';
    ctx.lineWidth = 2;
}

// draws the simulator name at the top of the OLED screen
function drawOLEDHeader() {
    ctx.font = '20px monospace';
    ctx.fillText('DRK-26-001   SIM', 22, 32);

    ctx.beginPath();
    ctx.moveTo(20, 45);
    ctx.lineTo(492, 45);
    ctx.stroke();
}

// shows the power off message on the LED screen
function drawSystemOff() {
    ctx.font = '28px monospace';
    ctx.fillText('SYSTEM OFF', 155, 138);

    ctx.font = '17px monospace';
    ctx.fillText('CONNECT POWER', 174, 177);
}

// draws the engine state and selected flight mode
function drawEngineInfo() {
    const engineStatus = state.engine ? 'ON ' : 'OFF';

    ctx.fillText(
        `ENG: ${engineStatus}    MODE: ${state.mode}`,
        22,
        82
    );
}

// draws the current throttle percentage
function drawThrottleInfo() {
    const throttle = String(state.throttle).padStart(3);

    ctx.fillText(`THR: ${throttle}%`, 22, 116);
}

// draws the current aircraft altitude in feet
function drawAltitudeInfo() {
    const altitude = Math.round(state.altitude)
        .toLocaleString('en-US');

    ctx.fillText(`ALT: ${altitude} FT`, 22, 149);
}

// finds the current status of the aircraft
function getFlightStatus() {
    if (state.error) return 'ERROR';

    if (state.mode === 'LAND' && state.altitude === 0) {
        return 'LANDED';
    }

    return 'NORMAL';
}

// draws the current aircraft status on the OLED screen
function drawStatusInfo() {
    ctx.fillText(
        `STATUS: ${getFlightStatus()}`,
        22,
        184
    );
}

// draws a bar that shows how much throttle is being used
function drawThrottleBar() {
    const width = Math.round(464 * state.throttle / 100);

    ctx.strokeRect(22, 209, 468, 16);
    ctx.fillRect(24, 211, width, 12);
}

// draws all the aircraft information on the LED screen
function drawFlightInfo() {
    ctx.font = '19px monospace';

    drawEngineInfo();
    drawThrottleInfo();
    drawAltitudeInfo();
    drawStatusInfo();
    drawThrottleBar();
}

// updates the LED screen depending on the simulator state
function renderOLED() {
    prepareOLED();
    drawOLEDHeader();

    if (!state.power) {
        drawSystemOff();
        return;
    }

    drawFlightInfo();
}

// LED 

// updates the three LED indicators based on the simulator state
function updateLEDs() {
    $('powerLed').classList.toggle('on', state.power);

    $('engineLed').classList.toggle(
        'on',
        state.power && state.engine
    );

    $('errorLed').classList.toggle(
        'on',
        state.power && state.error
    );
}

// HTML DISPLAY

// updates the power and engine labels on the page
function updateSystemLabels() {
    $('systemText').textContent =
        state.power ? 'ON' : 'OFF';

    $('engineText').textContent =
        state.engine ? 'RUNNING' : 'OFF';
}

// updates the throttle and altitude values on the page
function updateFlightLabels() {
    $('throttleText').textContent =
        state.power ? `${state.throttle}%` : '0%';

    $('altitudeText').textContent =
        `${Math.round(state.altitude).toLocaleString('en-US')} ft`;

    $('modeText').textContent = state.mode;
}

// updates the message and changes its style if there is an error
function updateMessageDisplay() {
    $('message').textContent = state.message;

    $('message').classList.toggle(
        'error',
        state.error
    );
}

// updates the numbers shown beside the two sliders
function updateSliderLabels() {
    $('throttleOutput').textContent =
        `${state.throttle}%`;

    $('altitudeOutput').textContent =
        `${state.altitudeControl}%`;
}

// updates the audio status and the sound button text
function updateAudioLabels() {
    $('audioText').textContent =
        state.audioEnabled ? 'ENABLED' : 'MUTED';

    $('audioToggle').textContent =
        state.audioEnabled ? 'Mute sound' : 'Enable sound';
}

// updates the OLED screen, LEDs and all information on the page
function render() {
    renderOLED();
    updateLEDs();
    updateSystemLabels();
    updateFlightLabels();
    updateMessageDisplay();
    updateSliderLabels();
    updateAudioLabels();
}

// USER CONTROLS

// reads the throttle slider and updates the engine sound
function changeThrottle(value) {
    state.throttle = Number(value);

    updateEngineAudio();
    render();
}

// reads the altitude slider and saves the selected value
function changeAltitudeControl(value) {
    state.altitudeControl = Number(value);

    render();
}

// resets the simulator data while keeping the sound setting
function resetState() {
    Object.assign(state, {
        power: false,
        engine: false,
        throttle: 0,
        altitudeControl: 0,
        altitude: 0,
        mode: 'GROUND',
        error: false,
        message: 'Switch POWER on to begin the simulation!',
        landingPlayed: false
    });
}

// puts all the switches and sliders back to their starting positions
function resetControls() {
    $('power').checked = false;
    $('engine').checked = false;
    $('throttle').value = 0;
    $('altitude').value = 0;
    $('mode').value = 'GROUND';
}

// stops the engine and resets the whole simulator
function resetSimulator() {
    engineAudioStop();
    resetState();
    resetControls();
    render();
}

// connects all the HTML switches, sliders and buttons to their functions
function setupControls() {
    $('power').addEventListener('change', (e) => {
        setPower(e.target.checked);
    });

    $('engine').addEventListener('change', (e) => {
        setEngine(e.target.checked);
    });

    $('throttle').addEventListener('input', (e) => {
        changeThrottle(e.target.value);
    });

    $('altitude').addEventListener('input', (e) => {
        changeAltitudeControl(e.target.value);
    });

    $('mode').addEventListener('change', (e) => {
        setMode(e.target.value);
    });

    $('audioToggle').addEventListener('click', () => {
        toggleAudio();
    });

    $('reset').addEventListener('click', () => {
        resetSimulator();
    });
}

// ANIMATION LOOP

// saves the current time so we can measure the time between frames
let last = performance.now();

// calculates the time between two frames in seconds
function getDeltaTime(now) {
    const dt = Math.min((now - last) / 1000, 0.1);

    last = now;

    return dt;
}

// keeps updating the aircraft simulation and screen
function loop(now) {
    const dt = getDeltaTime(now);

    updateFlight(dt);
    render();

    requestAnimationFrame(loop);
}

// connects the controls and starts the simulation
function startSimulator() {
    setupControls();
    render();
    requestAnimationFrame(loop);
}

// starts everything when the JavaScript file is loaded
startSimulator();
