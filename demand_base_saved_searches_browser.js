const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const app = express();
const PORT = 5003;
app.use(cors());
let isStopped = false;
let browser = null;
let page = null;

async function loadUrl() {
    browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });

    page = await browser.newPage();
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
}

async function getDataFromPage(url, limit, res) {
    res.write(`data: [startScraping]\n\n`);
    let finding_found = true;

    let iframe;
    const iframeHandle = await page.waitForSelector('iframe', { timeout: 15000 });
    iframe = await iframeHandle.contentFrame(); // Assign iframe here
    if (!iframe) {
        console.error("Error: Unable to access iframe content.");
        res.write(`data: [iframeNotFound]\n\n`);
        return;
    }
    for (let index = 0; index < 100 && finding_found; index++) {
        const button = await iframe.$('.js-people-count');
        if (button) {
            await button.click();
            finding_found = false;
            break;
        } else {
            await page.waitForTimeout(1300);
        }
    }


    let retries = 100;
    let contentTable = null;
    const tbl_name_expected = ['DataTables_Table_1', 'DataTables_Table_1_wrapper'];
    let tbl_name = '';
    for (let attempt = 0; attempt < retries; attempt++) {
        tbl_name = tbl_name_expected[attempt % tbl_name_expected.length];
        contentTable = await iframe.$(`#${tbl_name} table tr`);
        const iframrows = await iframe.$$(`#${tbl_name} table tr`);
        if (contentTable && iframrows.length > 2) {
            break;
        }
        await page.waitForTimeout(1300);
    }
    if (!contentTable) {
        console.warn("No table found after retries. Continuing...");
    }
    let start_index = 2;
    let rowIndex = start_index;
    while (true) {
        const rows = await iframe.$$(`#${tbl_name} table tr`);
        if (rowIndex >= rows.length) {
            const isNextDisabled = await iframe.evaluate(() => {
                const nextButton = document.querySelector('#DataTables_Table_1_next');
                if (nextButton) {
                    return nextButton?.classList.contains('disabled');
                } else {
                    console.error("Next button is not found or interactable.");
                    return true;
                }
            });
            if (isNextDisabled) {
                console.log("No more pages to process. Exiting...");
                break;
            }
            await iframe.evaluate(() => {
                document.querySelector('#DataTables_Table_1_next').click();
            });
            rowIndex = start_index;
            await page.waitForTimeout(5000);
            continue;
        }

        const row = rows[rowIndex];
        if (!row) {
            await page.waitForTimeout(500);
            continue;
        }
        await page.waitForTimeout(300);
        await row.click();
        await page.waitForTimeout(1000);
        let name = await get_val(iframe, '.js-executive-name-text', 10);
        let email = await get_val(iframe, '.theme-people-email-value a', 10);
        let phone = await get_val(iframe, '.js-corporate-people-phone', 5);
        let address = await get_val(iframe, '.theme-executive-value.theme-address-value', 10);
        let uniqueKey = `${name}-${email}-${phone}-${address}`;
        let rowData = { name, email, phone, address, uniqueKey };
        res.write(`data: ${JSON.stringify(rowData)}\n\n`);

        await iframe.evaluate(() => {
            const checkedCheckboxes = document.querySelectorAll('#DataTables_Table_1_wrapper .select-record.select-empid:checked');
            checkedCheckboxes.forEach(checkbox => checkbox.click());
        });
        rowIndex++;
    }

    console.log("All rows processed.");
    res.write(`data: [endScraping]\n\n`);
    return;
}

async function get_val(iframe, selector, tryies) {
    let text = await iframe.$eval(selector, el => el.innerText).catch(() => "");
    for (let i = 0; i < tryies && text == ""; i++) {
        text = await iframe.$eval(selector, el => el.innerText).catch(() => "");
        await page.waitForTimeout(300);
    }
    return text;
}

app.get('/loadurl', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let url = req.query.url || '';
        res.write(`data: [Loading]\n\n`);

        await loadUrl();
        
        res.write(`data: [loadurlSuccess]\n\n`);
        res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        // res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write(`data: [ERROR]\n\n`);
        res.end();
    }
});

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

        await getDataFromPage(url, limit, res);
        res.write(`data: [DONE]\n\n`);
        console.timeEnd("Execution Time");
        res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        res.write(`data: [ERROR]\n\n`);
        res.end();
    }
});

app.get('/stop_scraping', (req, res) => {
    isStopped = true;  // Set flag to stop scraping
    browser.close();
    res.send({ message: "Scraping stopped" });
});

// app.listen(PORT, () => {
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is working `);
    // console.log(`Server is working / running on http://localhost:${PORT}`);
});