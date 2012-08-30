#!/usr/bin/env node

//var util = require('util');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Oz = require('../oz');

var INDENTx1 = '  ';
var RE_AUTOFIXNAME = /define\((?=[^'"])/;
var RE_REQUIRE = /(^|\W)require\((\[[\w'"\/\-\:,\n\r\s]*\]|.+)\,/gm;
var _runtime;
var logger = Object.create(console);
var _config = {};
var _input = '';
var _mods = Oz._mods;
var _capture_require;
var _require_holds = [];
var _scripts = {};
var _code_cache = {};
var _code_bottom = '';
var _delay_exec;
var _loader_readed;

/**
 * implement hook
 */
Oz.require = function(deps, block){
    if (_capture_require) {
        _require_holds.push.apply(_require_holds, typeof deps === 'string' ? [deps] : deps);
    } else {
        return Oz.oz.require.apply(this, arguments);
    }
};

/**
 * override
 */ 
Oz.require.config = function(opt){
    for (var i in opt) {
        if (i === 'baseUrl') {
            continue;
        }
        Oz._config[i] = opt[i];
    }
};

/**
 * implement hook
 */
Oz.exec = function(list){
    if (Oz._config.loader) {
        if (_loader_readed) {
            list.push({
                fullname: '__loader__',
                url: Oz._config.loader
            });
        } else {
            return _delay_exec = function(){
                Oz.exec(list);
            };
        }
    }
    var output_code = '', count = 0;
    logger.log('\n==> Building');
    list.reverse().forEach(function(mod){
        if (mod.url || !mod.fullname) {
            var import_code = this[mod.fullname || ''];
            if (!import_code) {
                return;
            }
            //seek(import_code);
            output_code += '\n/* @source ' + (mod.url || '') + ' */\n\n' 
                            + import_code;
            if (mod.url) {
                count++;
                logger.log(INDENTx1, 'import: ', mod.url);
            }
        }
    }, _code_cache);
    var output = get_output_name(_input);
    output_code += _code_bottom;
    fs.writeFile(output, output_code, function(err){
        if (err) {
            throw err;
        }
        logger.log(INDENTx1, count, 'files');
        logger.log(INDENTx1, 'target: ', output, '\n');
        logger.timeEnd('Success, built in');
    });
};

/**
 * implement hook
 */
Oz.fetch = function(m, cb){
    var url = m.url,
        is_undefined_mod,
        observers = _scripts[url];
    if (!observers) {
        observers = _scripts[url] = [cb];
        read(m, function(data){
            if (data) {
                try {
                    _capture_require = true;
                    vm.runInContext(data, _runtime);
                    _capture_require = false;
                    merge(_mods[m.fullname].deps, _require_holds);
                    _require_holds.length = 0;
                } catch(ex) {
                    logger.info(INDENTx1, 'unknown script: ', m.fullname);
                    _capture_require = false;
                    _require_holds.length = 0;
                }
                if (_mods[m.fullname] === m) {
                    is_undefined_mod = true;
                }
            }
            observers.forEach(function(ob){
                ob.call(this);
            }, m);
            if (data) {
                if (is_undefined_mod) {
                    if (_mods[m.fullname] === m) {
                        _code_cache[m.fullname] += '\ndefine("' + m.fullname + '", function(){});\n';
                    } else {
                        auto_fix_name(m.fullname);
                    }
                }
            }
            _scripts[url] = 1;
        });
    } else if (observers === 1) {
        cb.call(m);
    } else {
        observers.push(cb);
    }
};

function mix(target) {
    var objs = arguments, l = objs.length, o;
    if (l == 1) {
        objs[1] = target;
        l = 2;
        target = this;
    }
    for (var i = 1; i < l; i++) {
        o = objs[i];
        for (var n in o) {
            target[n] = o[n];
        }
    }
    return target;
}

function merge(origins, news){
    if (Array.isArray(origins)) {
        var lib = {};
        origins.forEach(function(i){
            lib[i] = 1;
        }, lib);
        news.forEach(function(i){
            if (!this[i]) {
                origins.push(i);
            }
        }, lib);
    } else {
        for (var i in news) {
            if (!origins.hasOwnProperty(i)) {
                origins[i] = news[i];
            }
        }
    }
    return origins;
}

function disable_methods(obj, cfg){
    cfg = cfg || obj;
    for (var i in cfg) {
        obj[i] = function(){};
    }
}

function read(m, cb){
    if (!fs.existsSync(_config.baseUrl + m.url)) {
        setTimeout(function(){
            logger.log(INDENTx1, 'undefined module: ', m.fullname);
            cb();
        }, 0);
        return;
    }
    fs.readFile(_config.baseUrl + m.url, 'utf-8', function(err, data){
        if (err) {
            throw err;
        }
        if (data) {
            _code_cache[m.fullname] = data;
        }
        cb(data);
    });
}

function seek(code){
    var deps = [], r;
    while (r = RE_REQUIRE.exec(code)) {
        //console.info("seek: ", r && r[2]);
    }
    return;
}

function auto_fix_name(mid){
    _code_cache[mid] = _code_cache[mid].replace(RE_AUTOFIXNAME, function($0){
        return $0 + '"' + mid + '", ';
    });
}

/**
 * @note naming pattern:
 * _g_src.js 
 * _g_combo.js 
 *
 * jquery.js 
 * jquery_pack.js
 * 
 * _yy_src.pack.js 
 * _yy_combo.js
 * 
 * _yy_bak.pack.js 
 * _yy_bak.pack_pack.js
 */
function get_output_name(file){
    return file.replace(/(.+?)(_src.*)?(\.\w+)$/, function($0, $1, $2, $3){
        return $1 + ($2 && '_combo' || '_pack') + $3;
    });
}

function load_config(file){
    if (!fs.existsSync(file)) {
        return false;
    }
    var json = fs.readFileSync(file, 'utf-8');
    mix(_config, JSON.parse(json));
    return true;
}

function main(argv, args){
    if (!args._.length) {
        logger.warn('need input file\n');
        return false;
    }
    logger.time('Success, built in');

    _input = args._[0];
    var input_dir = path.dirname(_input);

    load_config(path.join(path.dirname(argv[1]), 'ozconfig.json'));
    load_config(path.join(path.resolve('$HOME'), '.ozconfig'));
    load_config(path.join(input_dir, 'ozconfig.json'));

    _runtime = vm.createContext(
        merge(Oz, process)
    );
    _runtime.window = _runtime;
    _runtime.console = Object.create(logger);

    if (args['q'] || args['quiet']) {
        disable_methods(logger);
    }

    if (!args['enable-module-log']) {
        disable_methods(_runtime.console);
    }

    fs.readFile(_input, 'utf-8', function(err, data){
        if (err) {
            throw err;
        }
        _code_cache[''] = data;
        logger.log('\n==> Checking');
        _capture_require = true;
        vm.runInContext(data, _runtime);
        _capture_require = false;
        Oz.define('__main__', _require_holds.slice(), function(){});
        _require_holds.length = 0;
        Oz.require('__main__', function(){});
        //read loader script
        var loader = Oz._config.loader;
        if (loader) {
            read({
                fullname: '__loader__',
                url: loader
            }, function(){
                _loader_readed = true;
                if (_delay_exec) {
                    _delay_exec();
                }
            });
        }
    });
}

if (!module.parent) {
    main(process.argv, require('optimist').argv);
}