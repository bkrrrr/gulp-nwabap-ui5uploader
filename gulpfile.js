const gulp  = require('gulp');
const clear = require('clear');
const mocha   = require('gulp-mocha');
const jshint  = require('gulp-jshint');
const eslint  = require('gulp-eslint');

const log = require('fancy-log');
const c = require('ansi-colors');

gulp.task('eslint', function () {
    gulp.src(['*.js', 'test/*.js', 'lib/*.js'])
        .pipe(eslint())
        .pipe(eslint.format('stylish'));
});

gulp.task('jshint', function () {
    gulp.src(['*.js', 'test/*.js', 'lib/*.js'])
     .pipe(jshint())
     .pipe(jshint.reporter('jshint-stylish'));
});

gulp.task('lint', ['eslint', 'jshint']);

gulp.task('test', function () {
    gulp.src('test/*.js', { read: false })
        .pipe(mocha({ reporter: 'spec' }))
        .on('error', log);
});

gulp.task('default', ['lint', 'test']);

gulp.task('dev', function() {
    gulp.watch(['**/*.js', '!node_modules/**'], ['lint', 'test'], function(event) {
        clear();
        log(c.cyan(event.path.replace(process.cwd(), '')) + ' ' + event.type + '. (' + c.magenta(gutil.date('HH:MM:ss')) + ')');
    });
});
