// eslint-disable-next-line no-unused-vars
async function main (snpsInputSelector) {
  const elements = getDOMElements(snpsInputSelector)

  elements.analyzeBtn.addEventListener('click', async () => {
    if (validateDOMElements(elements, snpsInputSelector)) {
      const snpsToSearch = await fetchMpsData()
      if (!snpsToSearch) {
        console.error('Failed to load MPS data.')
        return
      }

      processFile(elements, snpsToSearch)
    }
  })
}

async function fetchMpsData () {
  try {
    const response = await fetch('./mps/mps-data.json') // TODO this should be passed in
    const mpsData = await response.json()

    if (mpsData && Object.keys(mpsData).length > 0) {
      return mpsData
    } else {
      console.error('Error: MPS data is empty')
      return null
    }
  } catch (error) {
    console.error('Error fetching MPS data:', error)
    return null
  }
}

function getDOMElements (snpsInputSelector) {
  const elements = {
    fileInput: document.getElementById('txt-file'),
    analyzeBtn: document.getElementById('analyze-btn'),
    resultsDiv: document.getElementById('results'),
    progressBar: document.getElementById('progress-bar'),
    progressContainer: document.getElementById('progress-container')
  }

  if (snpsInputSelector) {
    elements.snpsInput = document.querySelector(snpsInputSelector)
  }

  return elements
}

function validateDOMElements (elements, snpsInputSelector) {
  for (const key in elements) {
    if (elements[key] === null) {
      console.error(`DOM element ${key} not found.`)
      return false
    }
  }

  if (snpsInputSelector && !elements.snpsInput) {
    console.error('SNPs input selector not found.')
    return false
  }

  return true
}

function processFile (elements, mpsData) {
  elements.progressContainer.style.display = 'block'
  elements.progressBar.style.width = '0%'

  const file = elements.fileInput.files[0]
  if (!file) {
    alert('Please select a file!')
    return
  }
  console.log('file size=' + file.size)
  const maxSize = 1024 * 1024 * 100 // 100 Mb
  if (file.size > maxSize) {
    console.log('Streaming large file=' + file.name)
    if (getFileExtension(file.name) !== 'vcf') {
      alert('Large file is not a vcf file')
      return
    }
    parseFileStream(file, elements, mpsData, parseVCFData, '\t')
  } else {
    parseFile(file, elements, mpsData)
  }
}

function parseFile (file, elements, mpsData) {
  const reader = new FileReader()

  reader.onprogress = function (e) {
    if (e.lengthComputable) {
      const progress = Math.floor((e.loaded / e.total) * 100)
      elements.progressBar.style.width = progress + '%'
    }
  }

  reader.onload = function (e) {
    const result = e.target.result
    const firstLine = result.split('\n')[0] // get first line

    const twentyThreeAndMeHeader = 'generated by 23andMe'
    const ancestryHeader = '==> filename.txt <==='
    let parseRowFunction
    let delimiter

    if (firstLine.includes(twentyThreeAndMeHeader)) {
      console.log('detected 23andme data')
      parseRowFunction = parse23AndMeData
      delimiter = '\t'
    } else if (firstLine.includes(ancestryHeader)) {
      console.log('detected ancestry data')
      parseRowFunction = parseAncestryData
      delimiter = ','
    } else {
      alert('Unable to determine the filetype from the header.')
      return
    }

    parseFileStream(result, elements, mpsData, parseRowFunction, delimiter)
  }

  reader.onerror = function () {
    console.error('Error while reading file:', reader.error)
    alert('An error occurred while reading the file.')
    elements.progressContainer.style.display = 'none'
  }

  reader.readAsText(file)
}

function parseFileStream (file, elements, mpsData, parseRowFunction, delimiter) {
  const chunkSize = 1024 * 50 // 50KB
  let totalSnps = [] // aggregate all SNPs

  // for updating the progress bar
  const fileSize = file.size
  let processedSize = 0

  // eslint-disable-next-line no-undef
  Papa.parse(file, {
    chunkSize,
    dynamicTyping: true,
    delimiter,
    chunk: function (results, parser) {
      const data = results.data
      processedSize += chunkSize

      // update progress
      const progress = processedSize / fileSize * 100
      elements.progressBar.style.width = progress + '%'
      // elements.progressBar.innerHTML = progress.toFixed(0) + '%'

      try {
        const foundSnps = parseRowFunction(data, mpsData)
        totalSnps = totalSnps.concat(foundSnps)
      } catch (error) {
        console.error('Error while parsing chunk:', error)
        alert('An error occurred while parsing the file.')
        parser.abort()
      }
    },
    complete: function () {
      // update progress (processing)
      elements.progressBar.style.width = '100%'
      // elements.progressBar.innerHTML = '100%'
      renderTable(elements, totalSnps)
      elements.progressContainer.style.display = 'none'
    },
    error: function (error) {
      console.error('Error while reading file:', error)
      alert('An error occurred while reading the file.')
      elements.progressContainer.style.display = 'none'
    }
  })
}

function parseVCFData (data, mpsData) {
  const foundSnps = []
  data.forEach(row => {
    if (!row || row.length < 5 || (typeof row[0] === 'string' && row[0].startsWith('#'))) {
      return // skip these rows
    }
    const snp = row[2]
    if (mpsData[snp]) {
      foundSnps.push({
        rsid: snp,
        chromosome: row[0],
        position: row[1],
        genotype: row[4], // assuming genotype is in the 5th column
        phenotype: mpsData[snp].phenotype,
        broken_geno: nullOrEmptyString(mpsData[snp].broken_geno),
        gene: nullOrEmptyString(mpsData[snp].gene)
      })
    }
  })
  return foundSnps
}

function parseAncestryData (data, mpsData) {
  const foundSnps = []
  data.forEach(row => {
    if (!row || row.length < 4) {
      return // skip these rows
    }
    const snp = row[0]
    if (mpsData[snp]) {
      foundSnps.push({
        rsid: snp,
        chromosome: row[1],
        position: row[2],
        genotype: row[3],
        phenotype: mpsData[snp].phenotype,
        broken_geno: nullOrEmptyString(mpsData[snp].broken_geno),
        gene: nullOrEmptyString(mpsData[snp].gene)
      })
    }
  })
  return foundSnps
}

function parse23AndMeData (data, mpsData) {
  const foundSnps = []
  data.forEach(row => {
    if (!row || row.length < 4 || (typeof row[0] === 'string' && row[0].startsWith('#'))) {
      return // skip these rows
    }
    const snp = row[0]
    if (mpsData[snp]) {
      foundSnps.push({
        rsid: snp,
        chromosome: row[1],
        position: row[2],
        genotype: row[3],
        phenotype: mpsData[snp].phenotype,
        broken_geno: nullOrEmptyString(mpsData[snp].broken_geno),
        gene: nullOrEmptyString(mpsData[snp].gene)
      })
    }
  })
  return foundSnps
}

function getFileExtension (filename) {
  return filename.substring(filename.lastIndexOf('.') + 1)
}

function nullOrEmptyString (str) {
  return str !== null ? str : ''
}

function renderTable (elements, foundSnps) {
  // Sort the found SNPs by phenotype
  foundSnps.sort((a, b) => a.phenotype.localeCompare(b.phenotype))

  // Group the found SNPs by phenotype
  const groups = groupBy(foundSnps, 'phenotype')

  // Clear previous results
  elements.resultsDiv.innerHTML = ''

  // Loop through each group and create a table
  for (const phenotype in groups) {
    // Creating table title
    const title = document.createElement('h3')
    title.textContent = phenotype
    elements.resultsDiv.appendChild(title)

    // Creating table element
    const table = document.createElement('table')
    table.style.width = '100%'
    table.setAttribute('border', '1')

    const headerRow = document.createElement('tr')
    const columns = ['rsid', 'genotype', 'broken_geno', 'chromosome', 'position', 'gene']
    const columnDisplay = {
      rsid: 'RSID',
      genotype: 'Genotype',
      broken_geno: 'Broken',
      chromosome: 'Chromosome',
      position: 'Position',
      gene: 'Gene'
    }
    columns.forEach(column => {
      const th = document.createElement('th')
      th.textContent = columnDisplay[column]
      headerRow.appendChild(th)
    })

    table.appendChild(headerRow)

    groups[phenotype].forEach(snp => {
      const tr = document.createElement('tr')
      columns.forEach(column => {
        const td = document.createElement('td')
        const content = escapeHtml(String(snp[column]))
        td.innerHTML = column === 'rsid' ? linkToSnpedia(content) : content
        tr.appendChild(td)
      })
      table.appendChild(tr)
    })

    elements.resultsDiv.appendChild(table)
  }
}

// Group by function
function groupBy (arr, key) {
  return arr.reduce(function (rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x)
    return rv
  }, {})
};

function escapeHtml (unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function linkToSnpedia (snp) {
  return '<a href="https://www.snpedia.com/index.php/' + snp + '">' + snp + '</a>'
}
