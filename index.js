'use strict';

const path        = require('path');
const through     = require('through2');
const PluginError = require('plugin-error');

const Filestore   = require('./lib/filestore');
const Transports = require('./lib/transports');

// Constants
const PLUGIN_NAME = 'gulp-nwabap-ui5uploader';

function stream(options){
    let sources = [];
    let cwd = options.root ? path.resolve(options.root) : process.cwd();
    return through.obj(
        // Transform
        function (file, enc, done) {
            if (file.isStream()) {
                this.emit(
                    'error',
                    new PluginError(PLUGIN_NAME, 'Streams are not supported!')
                );
            }

            if (path.relative(cwd, file.path).indexOf('..') === 0) {
                this.emit(
                    'error',
                    new PluginError(PLUGIN_NAME, 'Source contains paths outside of root')
                );
            }

            sources.push(file);
            done(null, file);
        },

        // Flush
        function (done) {
            let store = new Filestore(options);
            let me = this;

            sources = sources.filter(function(source) {
                return !source.isNull();
            });

            let s = sources.map(function(source) {
                return path.relative(cwd, source.path).replace(/\\/g, '/') || '.';
            });

            store.syncFiles(s, cwd, function (error) {
                if (error) {
                    me.emit('error', new PluginError(PLUGIN_NAME, error));
                }

                done();
            });
        }
    );
}

function checkTransportForUpload(oTransportManager, options){
    if (options.ui5.create_transport === true) {
        oTransportManager.createTransport(options.ui5.package, options.ui5.transport_text, function (oError, sTransportNo) {
            if (oError) {
                throw new PluginError(PLUGIN_NAME, 'No transport configured but create transport and user match was disabled!');
            }
            options.ui5.transportno = sTransportNo;
            return stream(options);
        });
    } else {
        throw new PluginError(PLUGIN_NAME, 'No transport configured but create transport and user match was disabled!');
    }
}

module.exports = function (options) {
    if (typeof options !== 'object') {
            throw new PluginError(PLUGIN_NAME, 'options must be an object');
    }

    if (!options.auth || !options.auth.user || !options.auth.pwd) {
        throw new PluginError(PLUGIN_NAME, '"auth" option not (fully) specified (check user name and password).');
    }

    if (!options.conn || !options.conn.server) {
        throw new PluginError(PLUGIN_NAME, '"conn" option not (fully) specified (check server).');
    }

    if (!options.conn.hasOwnProperty('useStrictSSL')){
        options.conn.useStrictSSL = true;
    }

    if (!options.ui5 || !options.ui5.package || !options.ui5.bspcontainer || !options.ui5.bspcontainer_text) {
        throw new PluginError(PLUGIN_NAME, '"ui5" option not (fully) specified (check package, BSP container, BSP container text information).');
    }

    let bspcontainerExclNamespace = options.ui5.bspcontainer.substring(options.ui5.bspcontainer.lastIndexOf('/') + 1);
    if (bspcontainerExclNamespace.length > 15) {
        throw new PluginError(PLUGIN_NAME, '"ui5.bspcontainer" option must not be longer than 15 characters (exclusive customer specific namespace e.g. /YYY/.');
    }

    if (!options.ui5.language) {
        options.ui5.language = 'EN';
    }

    // transport related settings
    if (options.ui5.package !== '$TMP' && !options.ui5.transportno && options.ui5.create_transport !== true) {
        throw new PluginError(PLUGIN_NAME, 'For packages <> "$TMP" a transport number is necessary.');
    }

    if (options.ui5.create_transport === true && typeof options.ui5.transport_text !== 'string') {
        throw new PluginError(PLUGIN_NAME, 'Please specifiy a description to be used for the created transport in option "ui5.transport_text".');
    }


    // check transport
    if (options.ui5.package !== '$TMP' && options.ui5.transportno === undefined) {
        let oTransportManager = new Transports(options);
        if (options.ui5.transport_use_user_match) {
            oTransportManager.determineExistingTransport(options.ui5.transport_text, function (oError, sTransportNo) {
                if (sTransportNo) {
                    options.ui5.transportno = sTransportNo;
                    return stream();
                 } else {
                    return checkTransportForUpload(oTransportManager,options);
                }
            });

        } else {
            return checkTransportForUpload(oTransportManager, options);
        }
    } else {
        return stream(options);
    }
};
