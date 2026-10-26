// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

//- 题目描述：反转一个字符串。输入 "abcde"，输出 "edcba"

contract StringTool {

    function reverse(string memory s) public pure returns (string memory) {
        bytes memory b = bytes(s);
        if (b.length < 2) {
            return s;
        }
        uint256 i=0;
        uint256 j=b.length-1;
        while(i<j) {
            (b[i],b[j]) = (b[j],b[i]);
            i+=1;
            j-=1;
        }
        return string(b);
    }
}