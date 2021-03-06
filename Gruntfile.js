require('babel/register');

/**
 *
 *   grunt lint      Lint all source javascript
 *   grunt clean     Clean dist folder
 *   grunt build     Build dist javascript
 *   grunt test      Test dist javascript
 *   grunt default   Lint, Build then Test
 *
 */
module.exports = function(grunt) {
  grunt.initConfig({
    jshint: {
      options: {
        asi: true,
        curly: false,
        eqeqeq: true,
        esnext: true,
        expr: true,
        forin: true,
        freeze: false,
        immed: true,
        indent: 2,
        iterator: true,
        noarg: true,
        node: true,
        noempty: true,
        nonstandard: true,
        trailing: true,
        undef: true,
        unused: 'vars',
      },
      all: ['src/havelock.js']
    },
    clean: {
      build: ['dist/*']
    },
    mochaTest: {
      test: {
        options: {
          reporter: 'spec'
        },
        src: ['test/**/*.js']
      }
    }
  });


  var fs = require('fs');
  var babel = require('babel');
  var uglify = require('uglify-js');

  grunt.registerTask('compile', function () {
    var src = 'src/havelock.js';
    var dest = 'dist/havelock';
    var code = fs.readFileSync('src/havelock.js');

    var transformed = babel.transform(code, {
      blacklist: ["es6.tailCall", 'strict'],
      sourceMaps: true,
      modules: "ignore",
    });

    fs.writeFileSync(dest + '.js', transformed.code);
    fs.writeFileSync(dest + '.js.map', JSON.stringify(transformed.map, null, '\t'));

    var minifyResult = uglify.minify(transformed.code, {
      fromString: true,
      mangle: {
        toplevel: true
      },
      compress: {
        comparisons: true,
        pure_getters: true,
        unsafe: true
      },
      output: {
        max_line_len: 2048,
      },
      reserved: ['module', 'define', 'Havelock']
    });

    var minified = minifyResult.code;
    var copyright = fs.readFileSync('resources/COPYRIGHT');
    fs.writeFileSync(dest + '.min.js', copyright + minified);
  });

  var Promise = require("bluebird");
  var exec = require('child_process').exec;

  grunt.registerTask('make-docs', function () {
    var script = "docgen/target/docgen.js";
    var api = "havelock.api.edn";
    var tsOut = "dist/havelock.d.ts";
    var htmlOut = "index.html";

    if (!fs.existsSync("docs")) {
      fs.mkdirSync("docs");
    }

    var rootQ = null;
    if (fs.existsSync(script)) {
      console.log("docgen exists, skipping boot");
      rootQ = {then: function (cb) { return cb(); }};
    } else {
      console.log("docgen doesn't exist, compiling it...");
      rootQ = execp("boot cljs", "./docgen");
    }
    rootQ.then(function () {
      return execp(["node", script, api, tsOut, htmlOut].join(" "));
    }).then(function () {
      console.log("all done");
    }).then(this.async()).error(function (error) {
      setTimeout(function () {
        throw error;
      }, 0);
    });
  });



  function execp(cmd, cwd) {
    var resolve, reject;
    var promise = new Promise(function(_resolve, _reject) {
      resolve = _resolve;
      reject = _reject;
    });
    try {
      exec(cmd, {cwd: cwd || "./"}, function (error, out) {
        if (error) {
          reject(error);
        } else {
          resolve(out);
        }
      });
    } catch (error) {
      reject(error);
    }
    return promise;
  }

  grunt.registerTask('pages', function () {
    var done = this.async();
    execp('git checkout gh-pages').then(function () {
      return execp('git merge master');
    }).then(function () {
      return execp('git push origin gh-pages');
    }).then(function () {
      return execp('git checkout master');
    }).then(function () {
      console.log("gh-pages up to date");
    }).then(done);
  });

  grunt.registerTask('stats', function () {
    Promise.all([
      execp('cat dist/havelock.js | wc -c'),
      execp('git show master:dist/havelock.js | wc -c'),
      execp('cat dist/havelock.min.js | wc -c'),
      execp('git show master:dist/havelock.min.js | wc -c'),
      execp('cat dist/havelock.min.js | gzip -c | wc -c'),
      execp('git show master:dist/havelock.min.js | gzip -c | wc -c'),
    ]).then(function (results) {
      return results.map(function (result) { return parseInt(result); });
    }).then(function (results) {
      var rawNew = results[0];
      var rawOld = results[1];
      var minNew = results[2];
      var minOld = results[3];
      var zipNew = results[4];
      var zipOld = results[5];

      function space(n, s) {
        return Array(Math.max(0, 10 + n - (s||'').length)).join(' ') + (s||'');
      }

      function bytes(b) {
        return b.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' bytes';
      }

      function diff(n, o) {
        var d = n - o;
        return d === 0 ? '' : d < 0 ? (' ' + bytes(d)).green : (' +' + bytes(d)).red;
      }

      function pct(s, b) {
        var p = Math.floor(10000 * (1 - (s / b))) / 100;
        return (' ' + p + '%').grey;
      }

      console.log('  Raw: ' +
        space(14, bytes(rawNew).cyan) + '       ' + space(15, diff(rawNew, rawOld))
      );
      console.log('  Min: ' +
        space(14, bytes(minNew).cyan) + pct(minNew, rawNew) + space(15, diff(minNew, minOld))
      );
      console.log('  Zip: ' +
        space(14, bytes(zipNew).cyan) + pct(zipNew, rawNew) + space(15, diff(zipNew, zipOld))
      );

    }).then(this.async()).catch(function (error) {
      setTimeout(function () {
        throw error;
      }, 0);
    });
  });

  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-mocha-test')
  grunt.loadNpmTasks('grunt-release');

  grunt.registerTask('docs', 'build documentation', ['clean', 'make-docs'])
  grunt.registerTask('lint', 'Lint all source javascript', ['jshint']);
  grunt.registerTask('build', 'Build distributed javascript', ['clean', 'compile']);
  grunt.registerTask('test', 'Test built javascript', ['mochaTest']);
  grunt.registerTask('default', 'Lint, build and test.', ['lint', 'build', 'make-docs' , 'stats', 'test']);
}
