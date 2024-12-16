const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const app = express();
const PORT = 5003;
app.use(cors());
let isStopped = false;
let browser = null;

async function getDataFromPage(url, limit, res) {

    url = new URL(url);
    // url = new URL('https://web.demandbase.com/sales/saved?flow=saved-search&searchId=475215&searchName=China%201#results');
    let flow = url.searchParams.get('flow');
    let searchId = url.searchParams.get('searchId');
    let searchName = url.searchParams.get('searchName');

    browser = await chromium.launch({
        headless: true,
        // headless: 'new', 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    await page.goto('https://authentication.demandbase.com/signin');

    const usernameSelector = '#okta-signin-username';
    const passwordSelector = '#okta-signin-password';
    const submitSelector = '#okta-signin-submit';

    await page.waitForSelector(usernameSelector);
    await page.fill(usernameSelector, 'bgreer@shepherdsgm.com');

    await page.waitForSelector(passwordSelector);
    await page.fill(passwordSelector, 'Comfirm@2234');

    // Click submit
    await page.waitForSelector(submitSelector);
    await Promise.all([
        page.click(submitSelector),
        // page.waitForNavigation({ waitUntil: 'networkidle' })
    ]);
    res.write(`data: [loadingURL]\n\n`);

    let submitDemandbaseOne = 'xpath=//html/body/div[2]/div[1]/div[2]/div[2]/a[1]';
    await page.waitForSelector(submitDemandbaseOne, { timeout: 5000 });
    await page.click(submitDemandbaseOne);
    await page.waitForTimeout(10000);
    await page.goto('https://my.insideview.com/app/sales/saved/?flow=saved-search&searchId=' + searchId + '&searchName=' + searchName + '&page-source=psd#results'); //1026419,727617
    await page.waitForTimeout(10000);
    // await page.waitForLoadState('networkidle');
    const xpath = '//*[@id="target-modes-tab-container"]/div[1]/div[2]/div[7]/div[5]/div/div[3]/div[3]/div[1]/div/span[2]';
    // js-people-count
    let finding_found = true;
    let frameElementHandle;
    try {
        // Wait for an iframe to load on the page

        // await page.waitForSelector('iframe', { timeout: 10000 }); // Adjust timeout as needed

        for (let index = 0; index < 100 && finding_found; index++) {
            // const frames = page.frames();
            // for (let frame of frames) {
            try {
                const button = await page.$('.js-people-count');
                if (button) {
                    console.log('Element found in iframe');

                    await button.click();
                    finding_found = false;
                    break;
                } else {
                    console.log('Element not found in iframe');
                    await page.waitForTimeout(1300);
                }
            } catch (frameError) {
                console.error(`Error while accessing frame: ${frameError.message}`);
            }
            // }
            if (finding_found) {
                await page.waitForTimeout(1300);
            }
        }
    } catch (error) {
        console.error(`Error while waiting for iframe or executing loop: ${error.message}`);
    }

    console.log('after btn');

    let retries = 100;
    let contentTable;
    let contentFrame;
    for (let attempt = 0; attempt < retries; attempt++) {

        try {
            contentTable = await page.waitForSelector('#DataTables_Table_1_wrapper', { timeout: 5000 });
            if (contentTable) {
                console.log('DataTables_Table_1_wrapper Table found!');
                break;
            }
            else {
                await page.waitForTimeout(1300);
            }
        } catch (tableError) {
            console.error('Table not found within the timeout period.');
        }
    }
    await page.waitForTimeout(5000);

    let start_index = 2;
    let rowIndex = start_index;
    let extractedData = [];
    while (true) {
        // Fetch rows dynamically in each iteration to handle DOM changes
        let rows = await page.$$('#DataTables_Table_1_wrapper table tr', { timeout: 10000 });
        console.log('Total rows: ' + rows.length);
        if (rowIndex >= rows.length) {
            let isNextDisabled = await page.evaluate(() => {
                let nextButton = document.querySelector('#DataTables_Table_1_next');
                return nextButton?.classList.contains('disabled');
            });
            if (isNextDisabled) {
                console.log('No more pages to process. Exiting...');
                console.log('All rows processed.');
                break;
            }
            else{
                await page.evaluate(() => {
                    document.querySelector('#DataTables_Table_1_next').click();
                });
                rowIndex = start_index;
                // await page.click('#DataTables_Table_1_next');
                await page.waitForTimeout(5000);
                continue;
            }
        }

        let row = rows[rowIndex];
        if (!row) {
            console.log(`Row ${rowIndex + 1} not found. Retrying...`);
            await page.waitForTimeout(500);
            continue;
        }

        try {
            await page.waitForTimeout(300);

            await row.click();

            console.log(`Clicked row ${rowIndex + 1}`);
            await page.waitForTimeout(1000);


            // await page.waitForSelector('.theme-people-email-value a', { timeout: 5000 });
            const name = (await (await page.$('.js-executive-name-text', { timeout: 5000 }))?.innerText()) || "";
            const email = (await (await page.$('.theme-people-email-value a', { timeout: 5000 }))?.innerText()) || "";
            const phone = (await (await page.$('.js-corporate-people-phone', { timeout: 5000 }))?.innerText()) || "";
            const address = (await (await page.$('.theme-executive-value.theme-address-value'))?.innerText()) || "";

            const uniqueKey = `${name}-${email}-${phone}-${address}`;
            console.log("Info", uniqueKey);

            const rowData = { name,email, phone, address, uniqueKey };
            res.write(`data: ${JSON.stringify(rowData)}\n\n`);

            await page.evaluate(() => {
                // Select only the checked checkboxes within the table
                const checkedCheckboxes = document.querySelectorAll('#DataTables_Table_1_wrapper .select-record.select-empid:checked');
            
                // Uncheck each checked checkbox
                checkedCheckboxes.forEach((checkbox) => {
                    checkbox.click(); // Simulate a click to uncheck
                });
            });

            // await row.click();
            console.log(`Clicked row ${rowIndex + 1} again`);
        } catch (rowError) {
            console.error(`Error clicking row ${rowIndex + 1}: ${rowError.message}`);
        }
        rowIndex++;
    }

    console.log('All rows processed.');
    return;


    await browser.close();
    return data;
}
app.get('/demand_base', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        console.time("Execution Time");
        req.on('close', () => {
            console.log('Client disconnected.');
            isStopped = true;  // Set flag to stop scraping
            browser.close();
        });

        let limit = parseInt(req.query.limit) || 5;
        let url = req.query.url || '';
        isStopped = false;
        res.write(`data: [loggingIn]\n\n`);

        const data = await getDataFromPage(url, limit, res);

        console.log(`Received request with limit: ${limit}`);

        // Signal completion of data stream
        res.write(`data: [DONE]\n\n`);
        console.timeEnd("Execution Time");
        res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

app.get('/stop_scraping', (req, res) => {
    isStopped = true;  // Set flag to stop scraping
    browser.close();
    res.send({ message: "Scraping stopped" });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is working / running on http://localhost:${PORT}`);
});

// app.listen(PORT, () => {
//     console.log(`Server is running on http://localhost:${PORT}`);
// });
