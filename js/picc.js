---
# // with frontmatter, we can use {{ variable }} template tags
---
(function(exports) {

  var picc = exports.picc = {};

  picc.BASE_URL = '{{ site.baseurl }}';

  picc.API = (function() {
    var API = {
      url: '{{ site.API.baseurl }}',
      key: '{{ site.API.key }}'
    };

    var schoolEndpoint = 'school/';
    var idField = 'id';

    API.get = function(uri, params, done) {
      // console.debug('[API] get("%s", %s)', uri, JSON.stringify(params));
      if (arguments.length === 2) {
        done = params;
        params = addAPIKey({});
      } else if (params) {
        params = addAPIKey(params);
      }
      if (params) uri = join([uri, params], '?');
      var url = join([API.url, uri], '/');
      console.debug('[API] get: "%s"', url);
      return d3.json(url, done);
    };

    API.load = function(uri, done) {
      var ext = uri.split('.').pop();
      var load = d3[ext || 'json'];
      return load(uri, done);
    };

    API.endpoint = function(uri) {
      return function endpoint(params, done) {
        return API.get(uri, params, done);
      };
    };

    API.search = API.endpoint(schoolEndpoint);

    API.getSchool = function(id, done) {
      var data = {};
      data[idField] = id;
      return API.get(schoolEndpoint, data, function(error, res) {
        if (error || !res.total) {
          return done(error.responseText || 'No such school found.');
        } else if (res.total > 1) {
          console.warn('More than one school found for ID: "' + id + '"');
        }
        return done(null, res.results[0]);
      });
    };

    API.getAll = function(urls, done) {
      Object.keys(urls).forEach(function(key) {
        var url = urls[key];
        urls[key] = Array.isArray(url)
          ? function(done) {
            var method = url.shift();
            if (typeof method === 'string') {
              method = API[method];
            }
            url.push(done);
            return method.apply(API, url);
          }
          : function(done) {
            return API.get(url, done);
          };
      });
      // console.log('getAll:', urls);
      return async.parallel(urls, done);
    };

    function addAPIKey(params) {
      var param = 'api_key';
      if (typeof params === 'object') {
        if (API.key) params[param] = API.key;
        // collapse arrays into comma-separated strings
        // per the API
        collapseArrays(params);
        params = querystring.stringify(params);
      } else if (API.key) {
        params += ['&', param, '=', API.key].join('');
      }
      return params;
    }

    function join(list, glue) {
      for (var i = 0; i < list.length; i++) {
        var str = String(list[i]);
        if (str.charAt(0) === glue) {
          list[i] = str.substr(1);
        } else if (str.charAt(str.length - 1) === glue) {
          list[i] = str.substr(0, str.length - 1);
        }
      }
      return list.join(glue);
    }

    function collapseArrays(obj, glue) {
      if (!glue) glue = ',';
      for (var key in obj) {
        if (Array.isArray(obj[key])) {
          obj[key] = obj[key].join(glue);
        }
      }
      return obj;
    }

    return API;
  })();

  /*
   * This is a dictionary for the various "special designation"
   * columns. The race/ethnicity ones are all nested under the
   * `minority_serving` property, whereas the `women_only` and
   * `men_only` are top-level properties of each school API response
   * object.
   */
  var SPECIAL_DESIGNATIONS = {
    // TODO: rename 'aanapi' to 'aanapisi'?
    // per <http://www2.ed.gov/programs/aanapi/index.html>
    aanipi:               'AANAPI',
    hispanic:             'Hispanic',
    historically_black:   'Historically Black',
    predominantly_black:  'Predominantly Black',
    tribal:               'Tribal',
    women_only:           'Women Only',
    men_only:             'Men Only'
  };

  var NA = '--';

  /**
   * This is our format generator. Its methods are format generators for
   * specific types of values, and they take a key in the data object to
   * format. For instance:
   *
   * @example
   * var formatFoo = format.percent('foo');
   * formatFoo({foo: 0.5}) -> '50%'
   */
  picc.format = (function() {
    var formatter = function(fmt, _empty) {
      var round = false;
      if (typeof fmt === 'string') {
        round = !!fmt.match(/d$/);
        fmt = d3.format(fmt);
      }
      return function(key, empty) {
        empty = empty || _empty;
        if (typeof empty === 'string') {
          empty = d3.functor(empty);
        }
        key = key
          ? picc.access(key)
          : function(v) { return v; };
        return function(d) {
          var value = key.call(this, d);
          if (round) value = Math.round(value);
          return ((value === '' || isNaN(value)) && empty)
            ? empty.call(d)
            : fmt.call(d, +value, key);
        };
      };
    };

    var map = function(keys, fallback) {
      return function(key) {
        return keys[key] || fallback;
      };
    };

    var range = function(ranges) {
      var len = ranges.length;
      var i;
      return function(value) {
        value = +value;
        for (i = 0; i < len; i++) {
          var range = ranges[i];
          if (value >= range[0] && value < range[1]) {
            return range[2];
          }
        }
      };
    };

    return {
      // format.dollars('x')({x: 1000}) === '$1,000'
      dollars: formatter('$,d', NA),
      // format.percent('y')({x: 1000}) === '$1,000'
      percent: formatter('%.0f', NA),
      number: formatter(',d', NA),

      // format.plural('x', 'foo')({x: 1}) === 'foo'
      // format.plural('x', 'foo')({x: 2}) === 'foos'
      plural: function(key, singular, plural) {
        key = picc.access(key);
        if (!plural) plural = singular + 's';
        return function(d) {
          return key.call(this, d) == 1 ? singular : plural;
        };
      },

      // format.map('x', {1: 'a'})({x: 1}) === 'a'
      map: function(key, values, empty) {
        return formatter(map(values))
          .call(this, key, empty);
      },

      // format.control('control')({control: 1}) === 'Public'
      // format.control('control')({control: 2}) === 'Private non-profit'
      control: formatter(map({
        '1': 'Public',
        '2': 'Private non-profit',
        '3': 'Private for-profit'
      }, 'control unknown')),

      // format.preddeg('deg')({deg: 2}) === '2-year'
      // format.preddeg('deg')({deg: 3}) === '4-year'
      preddeg: formatter(map({
        '1': 'Certificate',
        '2': '2-year',
        '3': '4-year',
        '4': 'Graduate'
      }, NA)),

      zero: function(key) {
        key = picc.access(key);
        return function(d) {
          return key.call(this, d) == 0;
        };
      },

      sizeCategory: formatter(range([
        [0, 2000, 'Small'],
        [2000, 15000, 'Medium'],
        [15000, Infinity, 'Large']
      ]), 'size unknown'),

      // format.locale('locale')({locale: 11}) === 'City: Large'
      locale: formatter(map({
        '11': 'City: Large',
        '12': 'City: Midsize',
        '13': 'City: Small',
        '21': 'Suburb: Large',
        '22': 'Suburb: Midsize',
        '23': 'Suburb: Small',
        '31': 'Town: Fringe',
        '32': 'Town: Distant',
        '33': 'Town: Remote',
        '41': 'Rural: Fringe',
        '42': 'Rural: Distant',
        '43': 'Rural: Remote'
      }, 'locale unknown'))

    };
  })();

  picc.fields = {
    NAME:                 'school.name',
    CITY:                 'school.city',
    STATE:                'school.state',
    LOCATION:             'school.location',
    OWNERSHIP:            'school.ownership',
    LOCALE:               'school.locale',

    SIZE:                 '2013.student.size',

    WOMEN_ONLY:           'school.women_only',
    MEN_ONLY:             'school.men_only',
    MINORITY_SERVING:     'school.minority_serving',

    PREDOMINANT_DEGREE:   'school.degrees_awarded.predominant',
    UNDER_INVESTIGATION:  'school.HCM2',

    // net price
    // FIXME: this should be `net_price`
    NET_PRICE:            '2013.cost.avg_net_price',
    NET_PRICE_BY_INCOME:  '2013.cost.net_price',

    // completion rate
    COMPLETION_RATE:      '2013.completion.rate',

    RETENTION_RATE:       '2013.student.retention_rate',

    REPAYMENT_RATE:       '2013.repayment.3_yr_repayment_suppressed.overall',

    AVERAGE_TOTAL_DEBT:   '2013.debt.median_debt_suppressed.completers.overall',
    MONTHLY_LOAN_PAYMENT: '2013.debt.median_debt_suppressed.completers.monthly_payments',

    // FIXME: this will be renamed eventually
    AID_PERCENTAGE:       '2013.debt.loan_rate',

    MEDIAN_EARNINGS:      '2011.earnings.6_yrs_after_entry.median',

    // FIXME: pending #373
    EARNINGS_GT_25K:      '2011.earnings.gt_25k_p10',

    PROGRAM_PERCENTAGE:   '2013.academics.program_percentage',

    // FIXME: will become `2013.student.demographics.female_share`
    FEMALE_SHARE:         '2013.student.female',
    RACE_ETHNICITY:       '2013.student.demographics.race_ethnicity',
    AGE_ENTRY:            '2013.student.demographics.age_entry',

    ACT_25TH_PCTILE:      '2013.student.act_scores.25th_percentile.cumulative',
    ACT_75TH_PCTILE:      '2013.student.act_scores.75th_percentile.cumulative',
    ACT_MIDPOINT:         '2013.student.act_scores.midpoint.cumulative',

    SAT_CUMULATIVE_AVERAGE:   '2013.student.sat_scores.average.overall',

    SAT_READING_25TH_PCTILE:  '2013.student.sat_scores.25th_percentile.critical_reading',
    SAT_READING_75TH_PCTILE:  '2013.student.sat_scores.75th_percentile.critical_reading',
    SAT_READING_MIDPOINT:     '2013.student.sat_scores.midpoint.critical_reading',

    SAT_MATH_25TH_PCTILE:     '2013.student.sat_scores.25th_percentile.math',
    SAT_MATH_75TH_PCTILE:     '2013.student.sat_scores.75th_percentile.math',
    SAT_MATH_MIDPOINT:        '2013.student.sat_scores.midpoint.math',

    SAT_WRITING_25TH_PCTILE:  '2013.student.sat_scores.25th_percentile.writing',
    SAT_WRITING_75TH_PCTILE:  '2013.student.sat_scores.75th_percentile.writing',
    SAT_WRITING_MIDPOINT:     '2013.student.sat_scores.midpoint.writing',
  };

  picc.access = function(key) {
    return (typeof key === 'function')
      ? key
      : getter(key);
  };

  function getter(key) {
    if (typeof key !== 'string') {
      return function(d) { return d[key]; };
    }
    if (key.indexOf('.') > -1) {
      var bits = key.split('.');
      var len = bits.length;
      return function(d) {
        for (var i = 0; i < len; i++) {
          d = d[bits[i]];
          if (d === null || d === undefined) return d;
        }
        return d;
      };
    }
    return function(d) { return d[key]; };
  }

  /**
   * This is a function composer for nested field accessors. It
   * takes an arbitrary number of arugments that may be strings,
   * integers or functions; the latter of which is evaluated to
   * get a *key* into the current nested object. E.g.:
   *
   * @example
   * var f = picc.access.composed('foo', picc.access.yearDesignation);
   * assert.equal({common_degree: '2', {foo: {lt_four_year: 1}}}, 1);
   * assert.equal({common_degree: '3', {foo: {four_year: 1}}}, 1);
   *
   * @argument ... key
   * @return {*}
   */
  picc.access.composed = function(key, sub1, sub2, etc) {
    var keys = [].slice.call(arguments);
    var len = keys.length;
    return function nested(d) {
      var value = d;
      for (var i = 0; i < len; i++) {
        var key = keys[i];
        if (typeof key === 'function') {
          key = key.call(this, d);
          if (key === null) return key;
        }
        value = getter(key)(value);
        if (value === undefined || value === null) break;
      }
      return value;
    };
  };

  picc.access.publicPrivate = function(d) {
    var ownership = picc.access(picc.fields.OWNERSHIP)(d);
    switch (+ownership) {
      case 1: // public
        return 'public';

      case 2: // private
      case 3:
        return 'private';
    }
    return null;
  };

  picc.access.yearDesignation = function(d) {
    var degree = picc.access(picc.fields.PREDOMINANT_DEGREE)(d);
    switch (+degree) {
      case 2: // 2-year (AKA less than 4-year)
        return 'lt_four_year';
      case 3: // 4-year
        return 'four_year';
    }
    return null;
  };

  picc.access.nationalStat = function(stat, suffix) {
    if (suffix) {
      suffix = picc.access(suffix);
      return function(d) {
        var key = suffix.apply(this, arguments);
        return this.getAttribute([
          'data', stat, key
        ].join('-'));
      };
    } else {
      return function() {
        return this.getAttribute('data-' + stat);
      };
    }
  };

  picc.access.netPrice = picc.access.composed(
    picc.fields.NET_PRICE,
    picc.access.publicPrivate
  );

  picc.access.netPriceByIncomeLevel = function(level) {
    return picc.access.composed(
      picc.fields.NET_PRICE_BY_INCOME,
      picc.access.publicPrivate,
      'by_income_level',
      level
    );
  };

  picc.access.earningsMedian = picc.access.composed(
    picc.fields.MEDIAN_EARNINGS
  );

  picc.access.earnings25k = picc.access.composed(
    picc.fields.EARNINGS_GT_25K
  );

  picc.access.completionRate = function(d) {
    var rate = picc.access(picc.fields.COMPLETION_RATE)(d);
    var key = picc.access.yearDesignation(d);
    if (rate[key] === 0) {
      console.warn('completion rate key mismatch: expected "%s", but got zero:', key, rate);
      return rate.four_year || rate.lt_four_year;
    }
    return rate[key];
  };

  picc.access.partTimeShare = function(d) {
    // FIXME: this should be a single field?
    var prefix = '2013.student.';
    return +picc.access(prefix + 'PPTUG_EF')(d)
        || +picc.access(prefix + 'PPTUG_EF2')(d);
  };

  picc.access.retentionRate = function(d) {
    var retention = picc.access.composed(
      picc.fields.RETENTION_RATE,
      picc.access.yearDesignation
    )(d);
    if (!retention) return null;

    var size = picc.access.size(d);
    if (!size) return null;

    var ptShare = picc.access.partTimeShare(d);
    if (ptShare === null) return null;

    var pt = size * ptShare * retention.part_time;
    var ft = (size - size * ptShare) * retention.full_time;
    if (isNaN(pt) || isNaN(ft)) return null;

    // console.log('retention:', retention, [pt, ft], 'size:', size);
    return (pt + ft) / size;
  };

  picc.access.size = picc.access.composed(
    picc.fields.SIZE
  );

  picc.access.location = picc.access(picc.fields.LOCATION);

  /**
   * Returns an array of special designation strings for a given school object.
   *
   * @param {Object} school the school data object
   * @return {Array} an array of human-readable strings
   */
  picc.access.specialDesignations = function(d) {
    var designations = [];

    if (+picc.access(picc.fields.WOMEN_ONLY)(d)) {
      designations.push(SPECIAL_DESIGNATIONS.women_only);
    } else if (+picc.access(picc.fields.MEN_ONLY)(d)) {
      designations.push(SPECIAL_DESIGNATIONS.men_only);
    }

    var minorityServing = picc.access(picc.fields.MINORITY_SERVING)(d);
    if (minorityServing) {
      for (var key in SPECIAL_DESIGNATIONS) {
        if (+minorityServing[key]) {
          designations.push(SPECIAL_DESIGNATIONS[key]);
        }
      }
    }

    return designations;
  };

  picc.access.programAreas = function(d, metadata) {
    if (!metadata) metadata = d.metadata;
    if (!metadata || !metadata.dictionary) return [];

    var dictionary = metadata.dictionary;
    var field = picc.fields.PROGRAM_PERCENTAGE;
    var programs = picc.access(field)(d);
    // remove the year prefix
    field = field.replace(/^\d+\./, '');
    return Object.keys(programs || {})
      .map(function(key) {
        var value = programs[key];
        var dictKey = [field, key].join('.');
        var name = dictionary[dictKey]
          ? (dictionary[dictKey].description || key)
          : key;
        return {
          program:  name,
          percent:  value
        };
      })
      .filter(function(d) {
        return +d.percent > 0;
      });
  };

  picc.nullify = function(value) {
    return value === 'NULL' ? null : value;
  };

  /**
   * namespace for school-related stuff
   */
  picc.school = {};

  /**
   * common directives for school templates
   */
  picc.school.directives = (function() {
    var access = picc.access;
    var format = picc.format;
    var percent = format.percent();
    var fields = picc.fields;

    var href = function(d) {
      var name = access(fields.NAME)(d);
      name = name ? name.replace(/\W+/g, '-') : '(unknown)';
      return [
        picc.BASE_URL, '/school/?',
        d.id, '-', name
      ].join('');
    };

    var underInvestigation = {
      '@aria-hidden': function(d) {
        var flag = access(fields.UNDER_INVESTIGATION)(d);
        return +flag !== 1;
      }
    };

    return {
      title: {
        link: {
          text: access(fields.NAME),
          '@href': href
        }
      },

      name:           access(fields.NAME),
      city:           access(fields.CITY),
      state:          access(fields.STATE),

      under_investigation: underInvestigation,
      // FIXME this is a hack to deal with the issue of tagalong
      // not applying a directive to multiple elements
      under_investigation2: underInvestigation,

      size_number:    format.number(fields.SIZE),
      control:        format.control(fields.OWNERSHIP),
      locale_name:    format.locale(fields.LOCALE),
      years:          format.preddeg(fields.PREDOMINANT_DEGREE),
      size_category:  format.sizeCategory(fields.SIZE),

      // this is a direct accessor because some designations
      // (e.g. `women_only`) are at the object root, rather than
      // nested in `minority_serving`.
      special_designations: access.specialDesignations,

      average_cost: format.dollars(access.netPrice),
      average_cost_meter: {
        '@max':     access.nationalStat('max', access.publicPrivate),
        '@average': access.nationalStat('median', access.publicPrivate),
        '@value':   access.netPrice,
        label:      format.dollars(access.nationalStat('median', access.publicPrivate)),
        '@title':   debugMeterTitle
      },

      // income level net price stats
      net_price_income1: format.dollars(access.netPriceByIncomeLevel('0-30000')),
      net_price_income2: format.dollars(access.netPriceByIncomeLevel('30001-48000')),
      net_price_income3: format.dollars(access.netPriceByIncomeLevel('48001-75000')),
      net_price_income4: format.dollars(access.netPriceByIncomeLevel('75001-110000')),
      net_price_income5: format.dollars(access.netPriceByIncomeLevel('110001-plus')),

      grad_rate: format.percent(access.completionRate),
      grad_rate_meter: {
        '@average': access.nationalStat('median', access.yearDesignation),
        '@value':   access.completionRate,
        label:      format.percent(function() {
          return this.getAttribute('average');
        }),
        '@title':   debugMeterTitle
      },

      average_salary: format.dollars(access.earningsMedian),
      average_salary_meter: {
        '@value': access.earningsMedian,
        label:    format.dollars(function() {
          return this.getAttribute('average');
        }),
        '@title': debugMeterTitle
      },

      repayment_rate_percent: format.percent(fields.REPAYMENT_RATE),
      repayment_rate_meter: {
        '@value': access(fields.REPAYMENT_RATE),
        '@average': access.nationalStat('median'),
        label:    format.percent(function() {
          return this.getAttribute('average');
        })
      },

      average_total_debt: format.dollars(fields.AVERAGE_TOTAL_DEBT),
      average_monthly_loan_payment: format.dollars(fields.MONTHLY_LOAN_PAYMENT),

      federal_aid_percentage: format.percent(function(d) {
        var aid = access(fields.AID_PERCENTAGE)(d);
        if (!aid) return null;
        return Math.max(aid.federal, aid.pell) || null; // 0 is n/a
      }),

      earnings_gt_25k: format.percent(access.earnings25k),
      earnings_gt_25k_meter: {
        '@value': access.earnings25k,
        label: format.percent(function() {
          return this.getAttribute('average');
        }),
        '@title': debugMeterTitle
      },

      retention_rate_value: format.percent(access.retentionRate),
      retention_rate_meter: {
        '@value': access.retentionRate,
        label:    format.percent(function() {
          return this.getAttribute('average');
        }),
        '@title': debugMeterTitle
      },

      full_time_percent: format.number(function(d) {
        var pt = access.partTimeShare(d);
        return pt === null ? null : (100 - pt);
      }),

      part_time_percent: format.number(access.partTimeShare),

      gender_values: function(d) {
        var female = access(fields.FEMALE_SHARE)(d);
        if (female === null) return [];
        female = +female;
        return [
          {label: 'Female', value: female, percent: percent(female)},
          {label: 'Male', value: 1 - female, percent: percent(1 - female)}
        ];
      },

      race_ethnicity_values: function(d) {
        if (!d.metadata) return [];
        var dictionary = d.metadata.dictionary;
        var field = fields.RACE_ETHNICITY;
        var values = access(field)(d);
        var prefix = field + '.';
        return Object.keys(values)
          .map(function(key) {
            var value = picc.nullify(values[key]);
            var dict = dictionary[prefix + key];
            return {
              key: key,
              label: dict ? (dict.label || key) : key,
              value: value,
              percent: percent(value)
            };
          })
          .filter(function(d) {
            return d.value > 0;
          });
      },

      available_programs: function(d) {
        var areas = access.programAreas(d);
        return areas
          .sort(function(a, b) {
            return d3.ascending(a.program, b.program);
          });
      },

      num_available_programs: format.number(function(d) {
        return access.programAreas(d).length;
      }),

      popular_programs: function(d) {
        var areas = access.programAreas(d);
        if (areas.length) {
          var total = d3.sum(areas, picc.access('percent'));
          areas.forEach(function(d) {
            d.value = +d.percent / total;
            d.percent = percent(d.value);
          });
        }
        return areas
          .sort(function(a, b) {
            return d3.descending(a.value, b.value);
          })
          .slice(0, 5);
      },

      programs_plural: format.plural(function(d) {
        return access.programAreas(d).length;
      }, 'Program'),

      age_entry: function(d) {
        var age = picc.access(fields.AGE_ENTRY)(d);
        return age ? age : NA;
      },

      more_link: {
        '@href': href
      },

      act_scores_visible: {
        '@aria-hidden': format.zero(fields.ACT_MIDPOINT),
      },
      act_scores: {
        '@lower': access(fields.ACT_25TH_PCTILE),
        '@upper': access(fields.ACT_75TH_PCTILE),
        '@middle': access(fields.ACT_MIDPOINT),
      },

      sat_reading_scores_visible: {
        '@aria-hidden': format.zero(fields.SAT_READING_MIDPOINT),
      },
      sat_reading_scores: {
        '@lower': access(fields.SAT_READING_25TH_PCTILE),
        '@upper': access(fields.SAT_READING_75TH_PCTILE),
        '@middle': access(fields.SAT_READING_MIDPOINT),
      },

      sat_math_scores_visible: {
        '@aria-hidden': format.zero(fields.SAT_MATH_MIDPOINT),
      },
      sat_math_scores: {
        '@lower': access(fields.SAT_MATH_25TH_PCTILE),
        '@upper': access(fields.SAT_MATH_75TH_PCTILE),
        '@middle': access(fields.SAT_MATH_MIDPOINT),
      },

      sat_writing_scores_visible: {
        '@aria-hidden': format.zero(fields.SAT_WRITING_MIDPOINT),
      },
      sat_writing_scores: {
        '@lower': access(fields.SAT_WRITING_25TH_PCTILE),
        '@upper': access(fields.SAT_WRITING_75TH_PCTILE),
        '@middle': access(fields.SAT_WRITING_MIDPOINT),
      }
    };

    function debugMeterTitle(d) {
      return [
        'value: ', this.getAttribute('value'), '\n',
        'median: ', this.getAttribute('average')
      ].join('');
    }

  })();


  // form utilities
  picc.form = {};

  /**
   * Adds a "submit" listener to the provided formdb.Form
   * instance (or CSS selector) that intercepts its data,
   * formats it as a querystring, then does a client-side
   * redirect with window.location, effectively removing
   * the query string parameters for empty inputs.
   */
  picc.form.minifyQueryString = function(form) {

    // allow form to be a CSS selector
    if (typeof form !== 'object') {
      form = new formdb.Form(form);
    }

    form.on('submit', function(data, e) {
      var url = [
        form.element.action,
        querystring.stringify(data)
      ].join('?');

      window.location = url;
      e.preventDefault();
      return false;
    });

    return form;
  };

  // UI tools
  picc.ui = {};

  picc.ui.expandAccordions = function(selector, expanded) {
    if (arguments.length === 1) {
      expanded = selector;
      selector = null;
    }
    if (!selector) {
      selector = 'aria-accordion';
    }
    expanded = d3.functor(expanded);
    return d3.selectAll(selector)
      .filter(function() {
        return !!expanded.apply(this, arguments);
      })
      .property('expanded', true);
  };

  // this is the equivalent of $(function), aka DOMReady
  picc.ready = function(callback) {
    if (document.readyState === 'complete') {
      return callback();
    } else {
      window.addEventListener('load', callback);
    }
  };

  // debounce function
  picc.debounce = function(fn, delay) {
    var timeout;
    return function() {
      var context = this;
      var args = arguments;
      return timeout = setTimeout(function() {
        fn.apply(context, args);
      }, delay);
    };
  };

  picc.delegate = function(root, qualify, event, listener) {
    if (Array.isArray(event)) {
      return event.map(function(e) {
        return picc.delegate(root, qualify, e, listener);
      });
    }

    if (typeof event === 'object') {
      var listeners = {};
      for (var e in event) {
        listeners[e] = picc.delegate(root, qualify, e, event[e]);
      }
      return listeners;
    }

    var _listener = function(e) {
      if (qualify.call(e.target, e)) {
        listener.call(e.target, e);
      }
    };
    root.addEventListener(event, _listener, true);
    return listener;
  };

  picc.tooltip = {
    show: function showTooltip() {
      var tooltip = this.tooltip;
      if (!tooltip) {
        tooltip = document.getElementById(this.getAttribute('aria-describedby'));
        if (!tooltip) {
          return console.warn('no tooltip found for:', this);
        }
        this.tooltip = tooltip;
      }

      // console.log('show tooltip:', this, tooltip);
      tooltip.setAttribute('aria-hidden', false);
      var ref = this.querySelector('.tooltip-target') || this;
      picc.tooltip.constrain(tooltip, ref);
    },

    hide: function hideTooltip() {
      if (!this.tooltip) return;
      var tooltip = this.tooltip;
      tooltip.setAttribute('aria-hidden', true);
    },

    constrain: function(tooltip, parent) {
      // remove the tooltip so we can accurately calculate
      // the outer element's size
      if (parent === tooltip.parentNode) {
        parent.removeChild(tooltip);
      }

      var content = tooltip.querySelector('.tooltip-content') || tooltip;
      content.style.removeProperty('left');

      var outer = parent.getBoundingClientRect();
      parent.appendChild(tooltip);

      rect = content.getBoundingClientRect();

      var margin = 10;
      var offsetWidth = (rect.width - outer.width) / 2;
      var halfWidth = rect.width / 2;
      var bump = -halfWidth;

      var left = outer.left - offsetWidth;
      var leftEdge = margin / 2;
      var right = outer.right + offsetWidth;
      var rightEdge = window.innerWidth - margin * 2;

      if (right > rightEdge) {
        bump -= right - rightEdge;
      } else if (left < leftEdge) {
        bump += leftEdge - left;
      }

      if (bump) {
        content.style.left = Math.round(bump) + 'px';
      } else {
        content.style.removeProperty('left');
      }

      var bottom = outer.bottom + rect.height;
      var above = bottom > window.innerHeight;
      tooltip.classList.toggle('tooltip_above', above);
      tooltip.classList.toggle('tooltip_below', !above);
    }
  };

  picc.ready(function() {
    var described = 'aria-describedby';
    picc.delegate(
      document.body,
      function() {
        return this.hasAttribute(described)
            && this.getAttribute(described).match(/^tip-/);
      },
      {
        mouseenter: picc.tooltip.show,
        mouseleave: picc.tooltip.hide,
        focus:      picc.tooltip.show,
        blur:       picc.tooltip.hide
      }
    );
  });

})(this);
