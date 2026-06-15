$ErrorActionPreference = "Continue"
$jwt = Get-Content .sisyphus\evidence\.jwt -Raw
$apiKey = "pool-proxy-secret-key"
$base = "http://localhost:1931"
$dashHeaders = @{Authorization="Bearer $jwt"}
$apiHeaders = @{Authorization="Bearer $apiKey"}

function Save-Evidence($name, $content) {
    $path = ".sisyphus\evidence\qa-f3-$name.txt"
    $content | Out-File -FilePath $path -Encoding utf8
    Write-Host "Saved: $path"
}

function Try-Request($desc, $scriptBlock) {
    Write-Host "`n=== $desc ===" -ForegroundColor Cyan
    try {
        $result = & $scriptBlock
        return @{success=$true; data=$result; error=$null; status=$null}
    } catch {
        $statusCode = $null
        $body = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $body = $reader.ReadToEnd()
            } catch {}
        }
        return @{success=$false; data=$body; error=$_.Exception.Message; status=$statusCode}
    }
}

# Scenario 1: List combos baseline
$s1 = Try-Request "S1: List combos baseline" {
    Invoke-RestMethod -Uri "$base/api/combos" -Headers $dashHeaders
}
Save-Evidence "01-list-baseline" "Status: $(if($s1.success){'200 OK'}else{$s1.status})`nResponse:`n$($s1.data | ConvertTo-Json -Depth 5)"

# Scenario 2: Create combo
$body2 = @{name="e2e-test"; models=@("canva-image","qd-Auto")} | ConvertTo-Json
$s2 = Try-Request "S2: Create combo" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body2 -ContentType "application/json"
}
Save-Evidence "02-create" "Status: $(if($s2.success){'201 Created'}else{$s2.status})`nResponse:`n$($s2.data | ConvertTo-Json -Depth 5)"
$comboId = if ($s2.success) { $s2.data.id } else { $null }
Write-Host "Created combo id: $comboId"

# Scenario 3: Get one
$s3 = Try-Request "S3: Get one" {
    Invoke-RestMethod -Uri "$base/api/combos/$comboId" -Headers $dashHeaders
}
Save-Evidence "03-get-one" "Status: $(if($s3.success){'200 OK'}else{$s3.status})`nResponse:`n$($s3.data | ConvertTo-Json -Depth 5)"

# Scenario 4: Update combo
$body4 = @{strategy="round-robin"; stickyLimit=3} | ConvertTo-Json
$s4 = Try-Request "S4: Update combo" {
    Invoke-RestMethod -Uri "$base/api/combos/$comboId" -Method PATCH -Headers $dashHeaders -Body $body4 -ContentType "application/json"
}
Save-Evidence "04-update" "Status: $(if($s4.success){'200 OK'}else{$s4.status})`nResponse:`n$($s4.data | ConvertTo-Json -Depth 5)"

# Scenario 5: Reject invalid name
$body5 = @{name="bad name!"; models=@("canva-image")} | ConvertTo-Json
$s5 = Try-Request "S5: Reject invalid name" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body5 -ContentType "application/json"
}
Save-Evidence "05-invalid-name" "Status: $($s5.status)`nResponse:`n$($s5.data)"

# Scenario 6: Reject duplicate name
$body6 = @{name="e2e-test"; models=@("canva-image","qd-Auto")} | ConvertTo-Json
$s6 = Try-Request "S6: Reject duplicate name" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body6 -ContentType "application/json"
}
Save-Evidence "06-duplicate" "Status: $($s6.status)`nResponse:`n$($s6.data)"

# Scenario 7: Reject name colliding with real model
$body7 = @{name="canva-image"; models=@("qd-Auto")} | ConvertTo-Json
$s7 = Try-Request "S7: Reject collision with real model" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body7 -ContentType "application/json"
}
Save-Evidence "07-collision-real-model" "Status: $($s7.status)`nResponse:`n$($s7.data)"

# Scenario 8: Reject nested combo
$body8 = @{name="nested"; models=@("e2e-test")} | ConvertTo-Json
$s8 = Try-Request "S8: Reject nested combo" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body8 -ContentType "application/json"
}
Save-Evidence "08-nested-combo" "Status: $($s8.status)`nResponse:`n$($s8.data)"

# Scenario 9: Reject too many models
$models11 = 1..11 | ForEach-Object { "model-$_" }
$body9 = @{name="toomany"; models=$models11} | ConvertTo-Json
$s9 = Try-Request "S9: Reject too many models" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body9 -ContentType "application/json"
}
Save-Evidence "09-too-many" "Status: $($s9.status)`nResponse:`n$($s9.data)"

# Scenario 10: Combos in /api/models
$s10 = Try-Request "S10: GET /api/models contains combo" {
    Invoke-RestMethod -Uri "$base/api/models" -Headers $dashHeaders
}
$comboInApi = $false
if ($s10.success) {
    $arr = if ($s10.data.data) { $s10.data.data } else { $s10.data }
    $comboInApi = ($arr | Where-Object { $_.id -eq "e2e-test" -and $_.owned_by -eq "combo" }) -ne $null
}
Save-Evidence "10-api-models" "Status: $(if($s10.success){'200 OK'}else{$s10.status})`nCombo present: $comboInApi`nMatching entry:`n$(($arr | Where-Object { $_.id -eq 'e2e-test' }) | ConvertTo-Json -Depth 5)"

# Scenario 11: Combos in /v1/models
$s11 = Try-Request "S11: GET /v1/models contains combo" {
    Invoke-RestMethod -Uri "$base/v1/models" -Headers $apiHeaders
}
$comboInV1 = $false
if ($s11.success) {
    $arr = if ($s11.data.data) { $s11.data.data } else { $s11.data }
    $comboInV1 = ($arr | Where-Object { $_.id -eq "e2e-test" -and $_.owned_by -eq "combo" }) -ne $null
}
Save-Evidence "11-v1-models" "Status: $(if($s11.success){'200 OK'}else{$s11.status})`nCombo present: $comboInV1`nMatching entry:`n$(($arr | Where-Object { $_.id -eq 'e2e-test' }) | ConvertTo-Json -Depth 5)"

# Scenario 12: Settings update
$body12 = @{value="round-robin"} | ConvertTo-Json
$s12a = Try-Request "S12a: PUT combo_strategy" {
    Invoke-RestMethod -Uri "$base/api/settings/combo_strategy" -Method PUT -Headers $dashHeaders -Body $body12 -ContentType "application/json"
}
$s12b = Try-Request "S12b: GET combo_strategy" {
    Invoke-RestMethod -Uri "$base/api/settings/combo_strategy" -Headers $dashHeaders
}
Save-Evidence "12-settings" "PUT Status: $(if($s12a.success){'200 OK'}else{$s12a.status})`nPUT Response: $($s12a.data | ConvertTo-Json -Depth 5)`n`nGET Status: $(if($s12b.success){'200 OK'}else{$s12b.status})`nGET Response: $($s12b.data | ConvertTo-Json -Depth 5)"

# Scenario 13: Delete combo
$s13a = Try-Request "S13a: DELETE combo" {
    Invoke-RestMethod -Uri "$base/api/combos/$comboId" -Method DELETE -Headers $dashHeaders
}
$s13b = Try-Request "S13b: GET deleted combo" {
    Invoke-RestMethod -Uri "$base/api/combos/$comboId" -Headers $dashHeaders
}
Save-Evidence "13-delete" "DELETE Status: $(if($s13a.success){'200 OK'}else{$s13a.status})`nDELETE Response: $($s13a.data | ConvertTo-Json -Depth 5)`n`nGET-after-delete Status: $($s13b.status)`nGET Response: $($s13b.data)"

# Scenario 14: All fail behavior - create combo with non-existent providers
$body14a = @{name="allfail-test"; models=@("nonexistent-model-1","nonexistent-model-2")} | ConvertTo-Json
$s14a = Try-Request "S14a: Create combo with non-existent models" {
    Invoke-RestMethod -Uri "$base/api/combos" -Method POST -Headers $dashHeaders -Body $body14a -ContentType "application/json"
}
$allFailComboId = if ($s14a.success) { $s14a.data.id } else { $null }
Write-Host "All-fail combo id: $allFailComboId"

$body14b = @{model="allfail-test"; messages=@(@{role="user"; content="hello"})} | ConvertTo-Json
$s14b = Try-Request "S14b: chat completion all-fail" {
    Invoke-RestMethod -Uri "$base/v1/chat/completions" -Method POST -Headers $apiHeaders -Body $body14b -ContentType "application/json"
}
Save-Evidence "14-all-fail" "Create combo Status: $(if($s14a.success){'201 Created'}else{$s14a.status})`nCreate Response: $($s14a.data | ConvertTo-Json -Depth 5)`n`nChat Status: $($s14b.status)`nChat Response: $($s14b.data)`nError: $($s14b.error)"

# Cleanup all-fail combo
if ($allFailComboId) {
    Try-Request "Cleanup all-fail combo" {
        Invoke-RestMethod -Uri "$base/api/combos/$allFailComboId" -Method DELETE -Headers $dashHeaders
    } | Out-Null
}

Write-Host "`n=== BACKEND SCENARIO RESULTS ===" -ForegroundColor Yellow
$results = @{
    "S1 list-baseline"     = if ($s1.success) { "PASS" } else { "FAIL ($($s1.status))" }
    "S2 create"            = if ($s2.success) { "PASS" } else { "FAIL ($($s2.status))" }
    "S3 get-one"           = if ($s3.success) { "PASS" } else { "FAIL ($($s3.status))" }
    "S4 update"            = if ($s4.success) { "PASS" } else { "FAIL ($($s4.status))" }
    "S5 invalid-name"      = if ($s5.status -eq 400) { "PASS" } else { "FAIL (got $($s5.status))" }
    "S6 duplicate"         = if ($s6.status -eq 400) { "PASS" } else { "FAIL (got $($s6.status))" }
    "S7 collision-model"   = if ($s7.status -eq 400) { "PASS" } else { "FAIL (got $($s7.status))" }
    "S8 nested-combo"      = if ($s8.status -eq 400) { "PASS" } else { "FAIL (got $($s8.status))" }
    "S9 too-many"          = if ($s9.status -eq 400) { "PASS" } else { "FAIL (got $($s9.status))" }
    "S10 api-models"       = if ($comboInApi) { "PASS" } else { "FAIL (combo missing or wrong owned_by)" }
    "S11 v1-models"        = if ($comboInV1) { "PASS" } else { "FAIL (combo missing or wrong owned_by)" }
    "S12 settings"         = if ($s12a.success -and $s12b.success -and $s12b.data.value -eq "round-robin") { "PASS" } else { "FAIL" }
    "S13 delete"           = if ($s13a.success -and $s13b.status -eq 404) { "PASS" } else { "FAIL" }
    "S14 all-fail"         = if ($s14b.status -ge 500 -or ($s14b.data -match "unavailable|All combo|fail")) { "PASS" } else { "FAIL/CHECK (status $($s14b.status))" }
}
$results.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "$($_.Key): $($_.Value)" }
$results | ConvertTo-Json | Out-File ".sisyphus\evidence\qa-f3-summary.json" -Encoding utf8
