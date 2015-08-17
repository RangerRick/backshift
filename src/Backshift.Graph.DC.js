/**
 * Created by jwhite on 5/23/14.
 */

Backshift.namespace('Backshift.Graph.DC');

/** Draws a table with all of the sources values. */
Backshift.Graph.DC = Backshift.Class.create(Backshift.Graph, {

  defaults: function ($super) {
    return Backshift.extend($super(), {
      width: undefined,
      height: undefined,
      title: undefined,
      verticalLabel: undefined,
      clipboardData: undefined,
      replaceDiv: false, // (experimental) whether or not to render off-screen in a new div and replace the old one
      exportIconSizeRatio: 0.05, // relative size in pixels of "Export to CSV" icon - set to 0 to disable
      interactive: true, // whether to do fancier chart navigation with mouse input events
      step: false, // treats points a segments (similar to rrdgraph)
      zoom: true, // whether to allow zooming
    });
  },

  onInit: function () {
    // Used to hold a reference to the div that holds the status text
    this.statusBlock = null;
    this.idPrefix = new Date().getTime() + '' + Math.floor(Math.random() * 100000);
  },

  onBeforeQuery: function () {
    this.timeBeforeQuery = Date.now();
    this.updateStatus("Querying...");
  },

  onQuerySuccess: function (results) {
    this.drawGraphs(results);
    var timeAfterQuery = Date.now();
    var queryDuration = Number((timeAfterQuery - this.timeBeforeQuery) / 1000).toFixed(2);
    this.updateStatus("Successfully retrieved data in " + queryDuration + " seconds.");
  },

  onQueryFailed: function () {
    this.updateStatus("Query failed.");
  },

  updateStatus: function (status) {
    /*
    if (this.statusBlock) {
      this.statusBlock.text(status);
    } else {
      this.statusBlock = d3.select(this.element).append("p").attr("align", "right").text(status);
    }
    */
  },

  drawGraphs: function (results) {
    var self = this,
      numRows = results.columns[0].length,
      numColumns = results.columnNames.length,
      rows = [],
      val,
      i,
      k, row;

    /* make this element unique so we can refer to it when rendering */
    var id = self.element.getAttribute('data-graph-model') + self.idPrefix;
    self.element.id = id;

    if (self.title) {
      var el = jQuery(self.element);
      var titleChild = el.children('div.backshift-dc-title');
      if (titleChild.length === 0) {
        titleChild = jQuery(document.createElement('div'))
          .addClass('backshift-dc-title')
          .css('text-align', 'center')
          .css('font-weight', 'bolder')
          .css('font-size', 'larger')
          .width('100%')
          .appendTo(el);
      }
      titleChild.first().text(self.title);
    }

    for (i = 0; i < numRows; i++) {
      row = {};
      for (k = 0; k < numColumns; k++) {
        val = results.columns[k][i];
        if (k === 0) { // timestamp
          val = new Date(val);
        }
        if (val === null || val === undefined || val === 'NaN' || isNaN(val)) {
          val = NaN;
          // if this column is NaN, we don't add it to the row (see below)
          //continue;
        }
        row[results.columnNames[k]] = val;
      }
      // if all columns were NaN, then we'll only have a timestamp
      // don't bother putting this data into crossfilter
      if (Object.keys(row).length > 1) {
        rows.push(row);
      }
    }

    var minTime = results.columns[0][0],
      maxTime = results.columns[0][numRows-1],
      difference = maxTime - minTime;

    numRows = rows.length;
    var columnNames = results.columnNames.splice(1);

    if (!self.crossfilter) {
      self.crossfilter = crossfilter([]);
    }
    self.crossfilter.remove();
    self.crossfilter.add(rows);

    var xunits;

    if (difference < 90000000) {
      xunits = d3.time.hours;
    } else if (difference < 1209600000) {
      xunits = d3.time.days;
    } else if (difference < 7776000000) {
      xunits = d3.time.months;
    } else {
      xunits = d3.time.years;
    }

    // dimension by timestamp
    var dateDimension = self.crossfilter.dimension(function(d) {
      return d.timestamp;
    });

    var columnGroups = [];
    var yMin = Number.POSITIVE_INFINITY;
    var yMax = Number.NEGATIVE_INFINITY;

    var getGroup = function(columnName) {
      var reduceAdd = function(p,v) {
        if (isNaN(v[columnName])) {
          p.nanCount++;
        } else {
          p.total += v[columnName];
        }
        if (p.nanCount > 0) {
          p.value = NaN;
        } else {
          p.value = p.total;
        }
        //console.log('v=',v);
        //console.log('p=',p);
        return p;
      };

      var reduceDel = function(p,v) {
        if (isNaN(v[columnName])) {
          p.nanCount--;
        } else {
          p.total -= v[columnName];
        }
        if (p.nanCount > 0) {
          p.value = NaN;
        } else {
          p.value = p.total;
        }
        return p;
      };

      var reduceInitial = function() {
        return {nanCount:0, total:0, value:NaN};
      };
      return dateDimension.group().reduce(reduceAdd, reduceDel, reduceInitial);
    };

    for (i = 0; i < self.series.length; i++) {
      var columnName = self.series[i].metric;

      columnGroups[i] = getGroup(columnName);

      // used for determining min/max for the entire graph; this is horribly inefficient
      var ydim = self.crossfilter.dimension(function(d) {
        return d[columnName];
      }).filterFunction(function(d) {
        return !isNaN(d);
      });

      var min = ydim.bottom(1)[0];
      var max = ydim.top(1)[0];
      yMin = Math.min(yMin, min[columnName]);
      yMax = Math.max(yMax, max[columnName]);
    }

    if (yMin < 0) {
      yMin = yMin * 1.1;
    } else {
      yMin = yMin * 0.9;
    }
    if (yMax > 0) {
      yMax = yMax * 1.1;
    } else {
      yMax = yMax * 0.9;
    }

    //console.log('x: time scale: ' + minTime + ' through ' + maxTime);
    //console.log('y: linear scale: ' + yMin + ' through ' + yMax);

    if (self.chart) {
      self.chart.redraw();
    } else {
      var chart = dc.compositeChart('#' + id);

      var charts = [], colors = [], ser, itemCount = 0,
        accessor = function(d) {
          return d.value.value;
        },
        definedFunc = function(d) {
          return !isNaN(d.y);
        }
      ;

      for (i = 0; i < self.series.length; i++) {
        var lastChart, lastSeries, nextSeries;
        if (charts.length > 0) {
          lastChart = charts[charts.length - 1];
        }

        ser = self.series[i];
        if (i > 0) {
          lastSeries = self.series[i-1];
        }
        if (self.series[i+1]) {
          nextSeries = self.series[i+1];
        }

        var currentChart;
        if (ser.type === 'area' && ser.name === undefined && nextSeries && nextSeries.type === 'line' && ser.metric === nextSeries.metric) {
          // the measurements API defines an area graph by returning
          // 2 segments: the "area", and the "line".  dc.js will automatically
          // fill the area if we give it a line graph, so we do this to merge
          // area/line tuples into one chart definition
        } else if (ser.type === 'area') {
          itemCount++;
          if (colors.length) {
            lastChart.colors(colors);
          }
          colors = [ser.color];
          currentChart = dc.lineChart(chart)
            .renderArea(true)
            .group(columnGroups[i], ser.name)
            .valueAccessor(accessor)
            .defined(definedFunc)
            ;
          charts.push(currentChart);
        } else if (ser.type === 'line') {
          itemCount++;
          if (colors.length) {
            lastChart.colors(colors);
          }
          colors = [ser.color];
          currentChart = dc.lineChart(chart)
            .group(columnGroups[i], ser.name)
            .valueAccessor(accessor)
            .defined(definedFunc)
            ;
          if (lastSeries && lastSeries.type === 'area' && lastSeries.metric === ser.metric) {
            // this line graph is actually part of the previous area graph
            // in the series, so treat it as an area
            currentChart.renderArea(true);
          }
          charts.push(currentChart);
        } else if (ser.type === 'stack') {
          itemCount++;
          lastChart.stack(columnGroups[i], ser.name);
          colors.push(ser.color);
        }

        var timeFormat = d3.time.format('%Y-%m-%d %H:%M:%S');
        var numberFormat = d3.format('0.2f');
        if (currentChart) {
          currentChart
            .renderTitle(true)
            .title(function(p) {
              //console.log('title p=',p);
              return timeFormat(p.x) + ': ' + numberFormat(p.y);
              /*
              return [
                p.x,
                numberFormat(p.y)
              ];
              */
            })
            ;
        }
      }

      if (colors.length) {
        charts[charts.length - 1].colors(colors);
      }

      var legendItemHeight = 12,
        legendItemGap = 5,
        legendSize = (legendItemHeight * itemCount) + (legendItemGap * (itemCount - 1)),
        bottomMargin = legendSize + 30;

      if (this.height - legendSize < 200) {
        console.log("WARNING: legend is too big; falling back to rendering over the graph");
        legendSize = self.height - 20;
        bottomMargin = 30;
      }

      //console.log('charts=',charts);
      chart
        .renderHorizontalGridLines(true)
        .width(self.width)
        .height(self.height)
        .margins({
          top: 10,
          right: 20,
          bottom: bottomMargin,
          left: 50
        })
        .transitionDuration(50)
        .mouseZoomable(false)
        .zoomOutRestrict(true)
        .dimension(dateDimension)
        ;

      chart
        .x(d3.time.scale().domain([minTime, maxTime]))
        .round(xunits.round)
        .xUnits(xunits);

      chart
        //.y(d3.scale.linear().domain([yMin, yMax]))
        .yAxisLabel(self.verticalLabel)
        .elasticY(true)

        ;

      if (itemCount > 1) {
        var legend = dc.legend().x(80).y(self.height - legendSize).itemHeight(legendItemHeight).gap(legendItemGap);
        window.setTimeout(function() {
          console.log('legend=',legend);
        }, 5000);
        chart.legend(legend);
      }

      chart.xAxis().ticks(6);
      chart.yAxis().tickFormat(d3.format('.2s'));

      /*
      chart
        .on("preRender", function(chart){console.log('preRender:',chart);})
        .on("postRender", function(chart){console.log('postRender:',chart);})
        .on("preRedraw", function(chart){console.log('preRedraw:',chart);})
        .on("postRedraw", function(chart){console.log('postRedraw:',chart);})
        .on("filtered", function(chart, filter){console.log('filtered:',chart,filter);})
        .on("zoomed", function(chart, filter){console.log('zoomed:',chart,filter);});
        */

      //console.log('self=',self);
      //console.log('data=' + JSON.stringify(chart.dataSet()));
      chart
        .compose(charts)
        .brushOn(false)
        .render();
    }
  }
});
