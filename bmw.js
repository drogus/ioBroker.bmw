/**
 *      iobroker bmw Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 */
// jshint node:true, esversion:6, strict:global, undef:true, unused:true
"use strict";
const utils = require('./lib/utils'); // Get common adapter utils
const adapter = utils.adapter('bmw');
const MyAdapter = require('./myAdapter');
const BMWConnectedDrive = require('./connectedDrive');
const A = MyAdapter(adapter, main);
const bmw = new BMWConnectedDrive();

let progress = false;

A.stateChange = function (id, state) {
    return (!state || state.ack) ? Promise.resolve(`No Ack for ${id}`) :
        (id === A.ain + bmw.renameTranslate('_RefreshData') || id === bmw.renameTranslate('_RefreshData')) ?
        A.D(`Refresh data received from ${state.from}}`,
            progress ?
            Promise.reject(' Refresh Data will not be executed because other request is in progress!') :
            getCars()) :
        A.getObject(id)
        .then(obj =>
            obj && obj.native && obj.native.command ?
            bmw.executeService(id, obj.native.command) : Promise.reject(`no valid command ${obj.native.command} for ${A.ains}`))
        .catch(e => A.W(`stateChange Error ${e}!`));
};

A.messages = (msg) => {
    const id = A.T(msg.message) === 'string' && msg.message.startsWith(A.ain) ? msg.message.slice(A.ain.length) : msg.message;
    A.D(`Execute command "${msg.command}" with Message ${A.S(id)}`);
    switch (msg.command) {
        case 'send':
            if (!id || !(id in A.states)) return Promise.reject(`id not found ${id}`);
            return A.getObject(id)
                .then(obj =>
                    obj.common.role === 'button' ? A.stateChange(id, {
                        ack: false,
                        from: msg.from
                    }) : Promise.reject(A.W(`wrong send ${A.O(msg)} obj = ${A.O(obj)}`)),
                    err => Promise.reject(err))
                .then(() => A.D(`got message sent: ${msg.message}`));
        case 'get':
            return A.getState(id);
        default:
            return Promise.reject(A.D(`Invalid command '${msg.command} received with message ${A.O(msg)}`));
    }
};

function getCars() {
    const refresh = bmw.renameTranslate('_RefreshData');
    const lastok = bmw.renameTranslate('_LastGood');
    const lasterr = bmw.renameTranslate('_LastError');
    const odata = '_originalData';

    let states = {};
    if (progress)
        return Promise.resolve();
    progress = true; // don't run if progress is on!
    states[refresh] = true; // don't delete the refresh state!!!
    states[lastok] = true; // don't delete the lastok state!!!
    states[lasterr] = true; // don't delete the lasterr state!!!
    states[odata] = A.debug;
    return bmw.requestVehicles()
        .then(() => A.seriesIn(bmw.vehicles, car => A.seriesIn(bmw.vehicles[car], id => {
            if (id.endsWith('_vin_')) return Promise.resolve();
            let mcar = bmw.vehicles[car][id],
                mid = car + '.' + id;
            A.D(`${mid}: ${mcar}`);
            if (id.startsWith(bmw.remStart)) {
                let sid = id.slice(bmw.remStart.length),
                    st = {
                        id: car + '.' + sid,
                        name: sid,
                        write: true,
                        role: 'button',
                        type: 'string',
                        native: {
                            command: mcar
                        }
                    };
                mid = st;
                states[st.id] = true;
                mcar = bmw.translate('NOT_STARTED');
            } else {
                states[mid] = true;
                if (mid.endsWith('.google_maps_link'))
                    mid = {
                        id: mid,
                        name: mid,
                        write: true,
                        role: 'text.url',
                        type: 'string',
                    };
            }
            return A.makeState(mid, mcar, true);
        }, 10)))
        .then(() => bmw.ocardata ? A.makeState(odata, `${bmw.ocardata}`) : true)
        .then(() => A.makeState(lastok, `${A.dateTime(new Date())}`, A.I(`BMW updated car data for ${A.obToArray(bmw.vehicles).length} car(s)`, true)))
        .then(() => bmw.cleanup ? A.getObjectList({ // this check object list for old objects not transmitted anymore
            startkey: A.ain,
            endkey: A.ain + '\u9999'
        }).then(res => A.seriesOf(res.rows, item => states[item.id.slice(A.ain.length)] ? Promise.resolve() :
            A.D(`Delete unneeded state ${A.O(item)}`, A.removeState(item.id.slice(A.ain.length))), 2)) : true)
        .catch(err => A.W(`Error in GetCars, most probably the server is down! No data is changed:  ${err}`,
            A.makeState(lasterr, `${A.dateTime(new Date())}: ${A.O(err)}`, true)))
        .then(() => progress = false);
}

function main() {
    if (!adapter.config.scandelay || parseInt(adapter.config.scandelay) < 5)
        A.W(`BMW Adapter scan delay was ${adapter.config.scandelay} set to 5 min!`, adapter.config.scandelay = 5);
    A.scanDelay = parseInt(adapter.config.scandelay) * 60 * 1000; // minutes

    adapter.config.server = A.T(adapter.config.server) == 'string' && adapter.config.server.length > 10 ? adapter.config.server : 'www.bmw-connecteddrive.com';

    if ((A.debug = adapter.log.level == 'debug' || adapter.config.services.startsWith('debug!')))
        A.D(`Adapter will run in debug mode because 'debug!' flag as first letters in services!`,
            adapter.config.services = adapter.config.services.startsWith('debug!') ?
            adapter.config.services.slice(6) :
            adapter.config.services);

    A.I(`BMW will scan the following services: ${adapter.config.services}.`);

    A.wait(100) // just wait a bit to give other background a chance to complete as well.
        .then(() => bmw.initialize(adapter.config))
        .then(() => A.makeState({
            id: bmw.renameTranslate('_RefreshData'),
            'write': true,
            role: 'button',
            type: typeof true
        }, false))
        .then(() => getCars(A.scanTimer = setInterval(getCars, A.scanDelay)))
        .then(() => A.I(`BMW Adapter initialization finished, will scan ConnectedDrive every ${adapter.config.scandelay} minutes.`),
            err => A.W(`BMW initialization finished with error ${err}, will stop adapter!`, A.stop(true)));
}